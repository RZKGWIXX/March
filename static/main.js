
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the login page
    if (document.querySelector('.login-container')) {
        console.log('Login page detected');
        return;
    }

    // Chat functionality
    const socket = io();
    let currentRoom = 'general';
    let currentRoomType = 'public';
    let nickname = '';
    let isBlocked = false;
    let isMobile = window.innerWidth <= 768;

    // UI Elements
    const chatList = document.getElementById('chat-list');
    const messagesList = document.getElementById('messages');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-btn');
    const currentRoomElement = document.getElementById('current-room');
    const roomTypeElement = document.getElementById('room-type');
    const fileInput = document.getElementById('file-input');
    const uploadButton = document.getElementById('upload-btn');
    const userSearch = document.getElementById('user-search');
    const newChatBtn = document.getElementById('new-chat-btn');
    const createGroupBtn = document.getElementById('create-group-btn');
    const groupPanel = document.getElementById('group-panel');
    const menuToggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const mobileOptionsBtn = document.getElementById('mobile-chat-options');
    const mobileDropdown = document.getElementById('mobile-chat-dropdown');

    // Get nickname from server
    fetch('/users')
        .then(response => response.json())
        .then(users => {
            // Get current user nickname from the user info div
            const userInfo = document.querySelector('.user-info');
            if (userInfo) {
                nickname = userInfo.textContent.trim();
            }
            loadRooms();
            loadMessages(currentRoom);
            joinRoom(currentRoom);
        })
        .catch(error => {
            console.error('Error getting users:', error);
        });

    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            const currentTheme = document.body.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.body.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            this.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        });

        // Load saved theme
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.body.setAttribute('data-theme', savedTheme);
        themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }

    // Mobile menu toggle
    if (menuToggle) {
        menuToggle.addEventListener('click', function() {
            sidebar.classList.toggle('mobile-open');
        });
    }

    // Mobile options dropdown
    if (mobileOptionsBtn) {
        mobileOptionsBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            mobileDropdown.classList.toggle('show');
        });
    }

    // Close mobile dropdown when clicking outside
    document.addEventListener('click', function(e) {
        if (mobileDropdown && !mobileOptionsBtn.contains(e.target)) {
            mobileDropdown.classList.remove('show');
        }
    });

    // Send message
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && socket) {
            socket.emit('message', {
                room: currentRoom,
                nickname: nickname,
                message: message
            });
            messageInput.value = '';
        }
    }

    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }

    if (messageInput) {
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    }

    // File upload
    if (uploadButton && fileInput) {
        uploadButton.addEventListener('click', function() {
            fileInput.click();
        });

        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                uploadFile(file);
            }
        });
    }

    function uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('room', currentRoom);

        fetch('/upload_file', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log('File uploaded successfully');
            } else {
                alert('Upload failed: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Upload error:', error);
            alert('Upload failed');
        });
    }

    // Room management
    function loadRooms() {
        fetch('/rooms')
            .then(response => response.json())
            .then(rooms => {
                updateRoomList(rooms);
            })
            .catch(error => {
                console.error('Error loading rooms:', error);
            });
    }

    function updateRoomList(rooms) {
        if (!chatList) return;

        chatList.innerHTML = '';
        
        rooms.forEach(room => {
            const li = document.createElement('li');
            li.className = 'chat-item';
            if (room === currentRoom) {
                li.classList.add('active');
            }

            const roomDisplayName = room === 'general' ? '# general' : 
                                  room.startsWith('private_') ? getRoomDisplayName(room) : 
                                  `# ${room}`;

            const roomType = room === 'general' ? 'Public Chat' : 
                           room.startsWith('private_') ? 'Private Chat' : 'Group Chat';

            li.innerHTML = `
                <div class="chat-info">
                    <span class="chat-name">${roomDisplayName}</span>
                    <span class="chat-type">${roomType}</span>
                </div>
                <div class="chat-icon">${room === 'general' ? '🌐' : room.startsWith('private_') ? '👤' : '👥'}</div>
            `;

            li.addEventListener('click', function() {
                if (room !== currentRoom) {
                    switchRoom(room);
                }
            });

            chatList.appendChild(li);
        });
    }

    function getRoomDisplayName(room) {
        if (room.startsWith('private_')) {
            const users = room.replace('private_', '').split('_');
            return users.find(user => user !== nickname) || 'Unknown';
        }
        return room;
    }

    function switchRoom(room) {
        currentRoom = room;
        currentRoomType = room === 'general' ? 'public' : 
                         room.startsWith('private_') ? 'private' : 'group';
        
        updateRoomDisplay();
        loadMessages(room);
        joinRoom(room);
        updateRoomList();
        
        // Close mobile sidebar after switching
        if (sidebar) {
            sidebar.classList.remove('mobile-open');
        }
    }

    function updateRoomDisplay() {
        if (currentRoomElement) {
            const displayName = currentRoom === 'general' ? '# general' : 
                              currentRoom.startsWith('private_') ? getRoomDisplayName(currentRoom) : 
                              `# ${currentRoom}`;
            currentRoomElement.textContent = displayName;
            currentRoomElement.setAttribute('data-room', currentRoom);
        }

        if (roomTypeElement) {
            const typeText = currentRoom === 'general' ? 'Public Chat' : 
                           currentRoom.startsWith('private_') ? 'Private Chat' : 'Group Chat';
            roomTypeElement.textContent = typeText;
        }

        // Update UI based on room type
        updateUIForRoom();
    }

    function updateUIForRoom() {
        const blockBtn = document.getElementById('block-user-btn');
        const deleteBtn = document.getElementById('delete-room-btn');
        const settingsBtn = document.getElementById('settings-btn');

        if (blockBtn) {
            blockBtn.style.display = currentRoomType === 'private' ? 'block' : 'none';
        }

        if (deleteBtn) {
            deleteBtn.style.display = currentRoom !== 'general' ? 'block' : 'none';
        }

        if (settingsBtn) {
            settingsBtn.style.display = currentRoom === 'general' ? 'block' : 'none';
        }
    }

    function joinRoom(room) {
        if (socket) {
            socket.emit('join_room', { room: room });
        }
    }

    function loadMessages(room) {
        fetch(`/messages/${room}`)
            .then(response => response.json())
            .then(messages => {
                displayMessages(messages);
            })
            .catch(error => {
                console.error('Error loading messages:', error);
            });
    }

    function displayMessages(messages) {
        if (!messagesList) return;

        messagesList.innerHTML = '';
        
        messages.forEach(message => {
            addMessageToChat(message);
        });

        scrollToBottom();
    }

    function addMessageToChat(message) {
        if (!messagesList) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';

        const timestamp = new Date(message.timestamp * 1000).toLocaleTimeString();
        
        // Get user display info
        fetch(`/get_user_display_info/${message.nick}`)
            .then(response => response.json())
            .then(displayInfo => {
                const displayName = displayInfo.display_name;
                const avatarUrl = displayInfo.avatar;
                
                if (message.type === 'media') {
                    const isImage = message.file_type === 'image';
                    const mediaElement = isImage ? 
                        `<img src="${message.text}" class="shared-image" alt="Shared image">` :
                        `<video src="${message.text}" class="shared-video" controls></video>`;
                    
                    messageDiv.innerHTML = `
                        <div class="message-header">
                            <img src="${avatarUrl}" class="message-avatar" alt="${displayName}">
                            <span class="message-sender">${displayName}</span>
                            <span class="message-time">${timestamp}</span>
                        </div>
                        <div class="message-content">
                            ${mediaElement}
                        </div>
                    `;
                } else {
                    messageDiv.innerHTML = `
                        <div class="message-header">
                            <img src="${avatarUrl}" class="message-avatar" alt="${displayName}">
                            <span class="message-sender">${displayName}</span>
                            <span class="message-time">${timestamp}</span>
                        </div>
                        <div class="message-content">
                            ${message.text}
                        </div>
                    `;
                }

                messagesList.appendChild(messageDiv);
                scrollToBottom();
            })
            .catch(error => {
                console.error('Error getting user display info:', error);
                // Fallback display
                messageDiv.innerHTML = `
                    <div class="message-header">
                        <img src="/static/default-avatar.png" class="message-avatar" alt="${message.nick}">
                        <span class="message-sender">${message.nick}</span>
                        <span class="message-time">${timestamp}</span>
                    </div>
                    <div class="message-content">
                        ${message.text}
                    </div>
                `;
                messagesList.appendChild(messageDiv);
                scrollToBottom();
            });
    }

    function scrollToBottom() {
        if (messagesList) {
            messagesList.scrollTop = messagesList.scrollHeight;
        }
    }

    // Socket events
    socket.on('new_message', function(data) {
        if (data.room === currentRoom) {
            addMessageToChat({
                nick: data.nickname,
                text: data.message,
                timestamp: data.timestamp,
                type: data.type,
                file_type: data.file_type
            });
        }
    });

    socket.on('user_banned', function(data) {
        if (data.username === nickname) {
            alert(`You have been banned. Reason: ${data.reason}`);
            window.location.href = '/';
        }
    });

    socket.on('avatar_updated', function(data) {
        // Update avatar displays
        const avatars = document.querySelectorAll(`img[alt="${data.user}"]`);
        avatars.forEach(avatar => {
            if (avatar.classList.contains('message-avatar')) {
                avatar.src = data.avatar_url;
            }
        });
    });

    socket.on('online_users', function(data) {
        updateOnlineUsers(data.users);
    });

    function updateOnlineUsers(users) {
        // Update online status indicators
        const chatItems = document.querySelectorAll('.chat-item');
        chatItems.forEach(item => {
            const nameElement = item.querySelector('.chat-name');
            if (nameElement) {
                const roomName = nameElement.textContent;
                // Add online indicator logic here
            }
        });
    }

    // User search
    if (userSearch) {
        userSearch.addEventListener('input', function() {
            const query = this.value.toLowerCase();
            if (query.length > 0) {
                searchUsers(query);
            } else {
                hideUserSearchResults();
            }
        });
    }

    function searchUsers(query) {
        fetch(`/search_users?q=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(users => {
                showUserSearchResults(users);
            })
            .catch(error => {
                console.error('Search error:', error);
            });
    }

    function showUserSearchResults(users) {
        // Implementation for showing search results
        // This would create a dropdown with search results
    }

    function hideUserSearchResults() {
        // Implementation for hiding search results
    }

    // New chat button
    if (newChatBtn) {
        newChatBtn.addEventListener('click', function() {
            const username = prompt('Enter username to start private chat:');
            if (username && username.trim()) {
                createPrivateChat(username.trim());
            }
        });
    }

    function createPrivateChat(username) {
        fetch('/create_private', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nick: username })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                loadRooms();
                switchRoom(data.room);
            } else {
                alert('Failed to create private chat: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error creating private chat:', error);
        });
    }

    // Group creation
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', function() {
            if (groupPanel) {
                groupPanel.style.display = groupPanel.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    const createGroupConfirm = document.getElementById('create-group-confirm');
    const createGroupCancel = document.getElementById('create-group-cancel');
    const groupNameInput = document.getElementById('group-name-input');

    if (createGroupConfirm) {
        createGroupConfirm.addEventListener('click', function() {
            const groupName = groupNameInput.value.trim();
            if (groupName) {
                createGroup(groupName);
            }
        });
    }

    if (createGroupCancel) {
        createGroupCancel.addEventListener('click', function() {
            if (groupPanel) {
                groupPanel.style.display = 'none';
            }
            if (groupNameInput) {
                groupNameInput.value = '';
            }
        });
    }

    function createGroup(name) {
        fetch('/create_group', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: name })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                loadRooms();
                switchRoom(data.room);
                if (groupPanel) {
                    groupPanel.style.display = 'none';
                }
                if (groupNameInput) {
                    groupNameInput.value = '';
                }
            } else {
                alert('Failed to create group: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Error creating group:', error);
        });
    }

    // Initialize
    console.log('Chat application initialized');
});

// Settings functions (global scope for onclick handlers)
function showSettings() {
    // Implementation for showing settings modal
    console.log('Settings clicked');
}

function logout() {
    fetch('/logout', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            window.location.href = data.redirect;
        }
    })
    .catch(error => {
        console.error('Logout error:', error);
    });
}

function deleteAccount() {
    if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
        fetch('/delete_account', {
            method: 'POST'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = data.redirect;
            } else {
                alert('Failed to delete account: ' + data.error);
            }
        })
        .catch(error => {
            console.error('Delete account error:', error);
        });
    }
}
