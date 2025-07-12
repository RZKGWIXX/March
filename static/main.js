// Chat application JavaScript
let socket;
let nickname = '';
let currentRoom = 'general';
let isAdmin = false;

document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the login page, if so, return early
    if (document.querySelector('.login-form')) {
        return;
    }

    // Initialize chat application
    initializeChat();
});

function initializeChat() {
    console.log('Chat application initialized');

    const chatListElement = document.getElementById('chat-list');
    console.log('Chat list element:', chatListElement);

    const messagesDiv = document.getElementById('messages');
    console.log('Messages div:', messagesDiv);

    // Get nickname from template or session
    const nicknameElement = document.querySelector('[data-nickname]');
    if (nicknameElement) {
        nickname = nicknameElement.dataset.nickname;
    }
    console.log('Nickname:', nickname);

    // Check if user is admin
    isAdmin = nickname === 'Wixxy';

    // Initialize interface based on screen size
    if (window.innerWidth > 768) {
        console.log('Desktop interface activated');
        initializeDesktopInterface();
    } else {
        console.log('Mobile interface activated');
        initializeMobileInterface();
    }

    // Connect to socket
    connectToSocket();

    // Load initial data
    loadRooms();
    loadMessages(currentRoom);
}

function initializeDesktopInterface() {
    // Desktop-specific initialization
    setupDesktopEventListeners();
}

function initializeMobileInterface() {
    // Mobile-specific initialization
    setupMobileEventListeners();
}

function setupDesktopEventListeners() {
    // Message input handling
    const messageInput = document.getElementById('message-input');
    if (messageInput) {
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    // Send button
    const sendButton = document.getElementById('send-button');
    if (sendButton) {
        sendButton.addEventListener('click', sendMessage);
    }

    // Settings button
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', showSettings);
    }

    // Admin button - only show for Wixxy
    if (isAdmin) {
        const adminBtn = document.getElementById('admin-btn');
        if (adminBtn) {
            adminBtn.style.display = 'block';
            adminBtn.addEventListener('click', toggleAdminPanel);
        }
    }
}

function setupMobileEventListeners() {
    // Similar to desktop but with mobile-specific handling
    setupDesktopEventListeners();
}

function connectToSocket() {
    socket = io();

    socket.on('connect', function() {
        console.log('Connected to server');
        socket.emit('join_room', {room: currentRoom, nickname: nickname});
        loadRooms();
    });

    socket.on('new_message', function(data) {
        if (data.room === currentRoom) {
            displayMessage(data);
        }
        updateUnreadCount(data.room);
    });

    socket.on('user_banned', function(data) {
        if (data.username === nickname) {
            alert('You have been banned: ' + data.reason);
            window.location.href = '/';
        }
        loadRooms();
        if (currentRoom === 'general') {
            loadMessages(currentRoom);
        }
    });

    socket.on('user_unbanned', function(data) {
        loadRooms();
        if (currentRoom === 'general') {
            loadMessages(currentRoom);
        }
    });

    socket.on('avatar_updated', function(data) {
        updateUserAvatar(data.user, data.avatar_url);
    });

    socket.on('online_users_update', function(data) {
        updateOnlineUsersList(data.users);
    });

    socket.on('user_activity_update', function(data) {
        handleUserActivityUpdate(data);
    });
}

function loadRooms() {
    console.log('Loading rooms...');
    fetch('/rooms')
        .then(response => {
            console.log('Rooms response status:', response.status);
            return response.json();
        })
        .then(rooms => {
            console.log('Rooms received:', rooms);
            displayRooms(rooms);
            console.log('Rooms loaded successfully');
        })
        .catch(error => {
            console.error('Error loading rooms:', error);
        });
}

function displayRooms(rooms) {
    const chatList = document.getElementById('chat-list');
    if (!chatList) return;

    chatList.innerHTML = '';

    rooms.forEach(room => {
        const roomElement = document.createElement('div');
        roomElement.className = 'chat-item';
        if (room === currentRoom) {
            roomElement.classList.add('active');
        }

        roomElement.innerHTML = `
            <div class="chat-avatar">
                <span>${getRoomIcon(room)}</span>
            </div>
            <div class="chat-info">
                <div class="chat-name">${getRoomDisplayName(room)}</div>
                <div class="chat-preview" id="preview-${room}">...</div>
            </div>
            <div class="chat-meta">
                <span class="chat-time" id="time-${room}"></span>
                <span class="unread-count" id="unread-${room}" style="display: none;">0</span>
            </div>
        `;

        roomElement.addEventListener('click', () => switchRoom(room));
        chatList.appendChild(roomElement);
    });
}

function getRoomIcon(room) {
    if (room === 'general') return '🌐';
    if (room.startsWith('private_')) return '👤';
    return '👥';
}

function getRoomDisplayName(room) {
    if (room === 'general') return 'General';
    if (room.startsWith('private_')) {
        const users = room.replace('private_', '').split('_');
        return users.find(u => u !== nickname) || users[0];
    }
    return room;
}

function switchRoom(room) {
    if (room === currentRoom) return;

    // Leave current room
    socket.emit('leave', {room: currentRoom});

    // Update current room
    currentRoom = room;

    // Join new room
    socket.emit('join_room', {room: room, nickname: nickname});

    // Update UI
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });
    event.target.closest('.chat-item').classList.add('active');

    // Load messages for new room
    loadMessages(room);

    // Update room header
    updateRoomHeader(room);
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
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;

    messagesDiv.innerHTML = '';

    messages.forEach(message => {
        displayMessage(message);
    });

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function displayMessage(data) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';

    const isOwnMessage = data.nickname === nickname || data.nick === nickname;
    if (isOwnMessage) {
        messageDiv.classList.add('own-message');
    }

    const displayName = data.nickname || data.nick;
    const messageText = data.message || data.text;
    const timestamp = data.timestamp;

    let messageContent = '';

    if (data.type === 'media') {
        if (data.file_type === 'image' || messageText.match(/\.(jpg|jpeg|png|gif)$/i)) {
            messageContent = `<img src="${messageText}" alt="Image" class="message-image" onclick="openImageModal('${messageText}')">`;
        } else if (data.file_type === 'video' || messageText.match(/\.(mp4|mov|avi|webm|mkv|flv|wmv)$/i)) {
            messageContent = `<video controls class="message-video"><source src="${messageText}" type="video/mp4"></video>`;
        }
    } else {
        messageContent = messageText;
    }

    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-author">${displayName}</span>
            <span class="message-time">${formatTime(timestamp)}</span>
        </div>
        <div class="message-content">${messageContent}</div>
    `;

    // Add context menu for messages
    messageDiv.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        showMessageContextMenu(e, data, messageDiv);
    });

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMessage() {
    const messageInput = document.getElementById('message-input');
    if (!messageInput) return;

    const message = messageInput.value.trim();
    if (!message) return;

    socket.emit('message', {
        room: currentRoom,
        nickname: nickname,
        message: message
    });

    messageInput.value = '';
}

function formatTime(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

function updateRoomHeader(room) {
    const roomHeader = document.querySelector('.chat-header h2');
    if (roomHeader) {
        roomHeader.textContent = getRoomDisplayName(room);
    }
}

function showSettings() {
    const modal = document.createElement('div');
    modal.className = 'admin-panel';

    // Get current user avatar
    fetch(`/get_user_avatar/${nickname}`)
        .then(response => response.json())
        .then(data => {
            document.getElementById('settings-avatar').src = data.avatar || '/static/default-avatar.svg';
        })
        .catch(error => {
            console.error('Failed to get user avatar:', error);
        });

    modal.innerHTML = `
        <div class="admin-content">
            <h2>⚙️ Settings</h2>

            <div class="settings-section">
                <h3>🎨 Theme</h3>
                <div class="theme-selector">
                    <button class="theme-btn ${document.body.getAttribute('data-theme') === 'light' ? 'active' : ''}" onclick="switchTheme('light')">☀️ Light</button>
                    <button class="theme-btn ${document.body.getAttribute('data-theme') === 'dark' ? 'active' : ''}" onclick="switchTheme('dark')">🌙 Dark</button>
                </div>
            </div>

            <div class="settings-section">
                <h3>👤 Edit Profile</h3>
                <div class="profile-section">
                    <div class="avatar-section">
                        <img src="/static/default-avatar.svg" alt="Your avatar" class="settings-avatar" id="settings-avatar">
                        <button class="admin-btn" onclick="document.getElementById('avatar-input').click()">Change Avatar</button>
                        <input type="file" id="avatar-input" accept="image/*" style="display: none;">
                    </div>
                    <p><strong>Current nickname:</strong> ${nickname}</p>
                    <input type="text" id="new-nickname" placeholder="New nickname" maxlength="20">
                    <button class="admin-btn" onclick="changeNickname()">Change Nickname</button>
                    <textarea id="bio-input" placeholder="Enter your bio..." maxlength="200"></textarea>
                    <button class="admin-btn" onclick="updateBio()">Update Bio</button>
                </div>
            </div>

            <div class="settings-section">
                <h3>🔐 Account</h3>
                <button class="admin-btn" onclick="confirmDeleteAccount()">🗑️ Delete Account</button>
                <button class="admin-btn" onclick="logout()">🚪 Logout</button>
            </div>

            <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Close</button>
        </div>
    `;

    document.body.appendChild(modal);

    // Setup avatar upload
    const avatarInput = document.getElementById('avatar-input');
    avatarInput.addEventListener('change', uploadAvatar);

    // Load current bio
    fetch(`/get_user_profile/${nickname}`)
        .then(response => response.json())
        .then(data => {
            document.getElementById('bio-input').value = data.bio || '';
        })
        .catch(error => {
            console.error('Failed to get user profile:', error);
        });
}

// Admin panel function - only for Wixxy
function toggleAdminPanel() {
    if (nickname !== 'Wixxy') {
        showNotification('❌ Access denied', 'error');
        return;
    }

    const existingPanel = document.querySelector('.admin-panel');
    if (existingPanel) {
        existingPanel.remove();
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'admin-panel';

    modal.innerHTML = `
        <div class="admin-content">
            <h2>🛡️ Admin Panel</h2>

            <div class="admin-stats" id="admin-stats">
                <h3>📊 Server Statistics</h3>
                <div class="stats-loading">Loading stats...</div>
            </div>

            <div class="admin-section">
                <h3>👤 User Management</h3>
                <input type="text" id="admin-username" placeholder="Enter username">
                <input type="text" id="ban-reason" placeholder="Ban reason">
                <select id="ban-duration">
                    <option value="1">1 hour</option>
                    <option value="24">24 hours</option>
                    <option value="168">1 week</option>
                    <option value="720">1 month</option>
                    <option value="-1">Permanent</option>
                </select>
                <button class="admin-btn" onclick="banUserFromAdmin()">🚫 Ban User</button>
            </div>

            <div class="admin-section">
                <h3>📋 Banned Users</h3>
                <div id="banned-users-list">Loading...</div>
            </div>

            <div class="admin-section">
                <h3>💬 Chat Management</h3>
                <button class="admin-btn" onclick="clearCurrentChat()">🧹 Clear Current Chat</button>
            </div>

            <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Close</button>
        </div>
    `;

    document.body.appendChild(modal);

    // Load admin stats
    loadAdminStats();
    loadBannedUsers();
}

function loadAdminStats() {
    if (nickname !== 'Wixxy') return;

    fetch('/admin/stats')
        .then(response => response.json())
        .then(data => {
            if (data.success === false) {
                document.getElementById('admin-stats').innerHTML = '<div class="error">Access denied</div>';
                return;
            }

            const statsHtml = `
                <div class="stats-grid">
                    <div class="stat-item">
                        <h3>Total Users</h3>
                        <div class="stat-number">${data.total_users}</div>
                    </div>
                    <div class="stat-item">
                        <h3>Online Now</h3>
                        <div class="stat-number">${data.online_users}</div>
                    </div>
                </div>
                <div class="online-users-list">
                    <h4>Online Users:</h4>
                    <div class="online-users-container">
                        ${data.online_list.map(user => `
                            <div class="online-user">
                                <span class="user-name">${user.nickname}</span>
                                <span class="user-room">${user.room}</span>
                                <span class="online-indicator">🟢</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            document.getElementById('admin-stats').innerHTML = statsHtml;
        })
        .catch(error => {
            console.error('Failed to load admin stats:', error);
            document.getElementById('admin-stats').innerHTML = '<div class="error">Failed to load stats</div>';
        });
}

function loadBannedUsers() {
    if (nickname !== 'Wixxy') return;

    fetch('/admin/banned_users')
        .then(response => response.json())
        .then(data => {
            if (data.success === false) {
                document.getElementById('banned-users-list').innerHTML = '<div class="error">Access denied</div>';
                return;
            }

            const bannedList = document.getElementById('banned-users-list');
            if (data.banned.length === 0) {
                bannedList.innerHTML = '<div class="no-bans">No banned users</div>';
                return;
            }

            const bannedHtml = data.banned.map(ban => `
                <div class="banned-user">
                    <div class="ban-info">
                        <strong>${ban.username}</strong>
                        <div class="ban-details">
                            <div>Reason: ${ban.reason}</div>
                            <div>Until: ${ban.until}</div>
                            <div>By: ${ban.banned_by}</div>
                        </div>
                    </div>
                    <button class="admin-btn unban-btn" onclick="unbanUser('${ban.username}')">✅ Unban</button>
                </div>
            `).join('');

            bannedList.innerHTML = bannedHtml;
        })
        .catch(error => {
            console.error('Failed to load banned users:', error);
            document.getElementById('banned-users-list').innerHTML = '<div class="error">Failed to load banned users</div>';
        });
}

function banUserFromAdmin() {
    if (nickname !== 'Wixxy') return;

    const username = document.getElementById('admin-username').value.trim();
    const reason = document.getElementById('ban-reason').value.trim();
    const duration = parseInt(document.getElementById('ban-duration').value);

    if (!username || !reason) {
        showNotification('❌ Please provide username and reason', 'error');
        return;
    }

    fetch('/admin/ban_user', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username, reason, duration})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('✅ User banned successfully', 'success');
            document.getElementById('admin-username').value = '';
            document.getElementById('ban-reason').value = '';
            loadBannedUsers();
        } else {
            showNotification('❌ ' + (data.error || 'Failed to ban user'), 'error');
        }
    })
    .catch(error => {
        console.error('Failed to ban user:', error);
        showNotification('❌ Error banning user', 'error');
    });
}

function unbanUser(username) {
    if (nickname !== 'Wixxy') return;

    fetch('/admin/unban_user', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('✅ User unbanned successfully', 'success');
            loadBannedUsers();
        } else {
            showNotification('❌ Failed to unban user', 'error');
        }
    })
    .catch(error => {
        console.error('Failed to unban user:', error);
        showNotification('❌ Error unbanning user', 'error');
    });
}

function clearCurrentChat() {
    if (nickname !== 'Wixxy') return;

    if (confirm('Are you sure you want to clear all messages in this chat?')) {
        fetch('/admin/clear_chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({room: currentRoom})
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('✅ Chat cleared successfully', 'success');
                loadMessages(currentRoom);
            } else {
                showNotification('❌ Failed to clear chat', 'error');
            }
        })
        .catch(error => {
            console.error('Failed to clear chat:', error);
            showNotification('❌ Error clearing chat', 'error');
        });
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function showMessageContextMenu(event, messageData, messageElement) {
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';

    const isOwnMessage = messageData.nickname === nickname || messageData.nick === nickname;

    let menuItems = '';

    if (isOwnMessage || nickname === 'Wixxy') {
        menuItems += '<div class="context-item" onclick="deleteMessage(event)">🗑️ Delete for everyone</div>';
    }

    menuItems += '<div class="context-item" onclick="hideMessage(event)">👁️ Hide for me</div>';

    if (messageData.message || messageData.text) {
        menuItems += '<div class="context-item" onclick="forwardMessage(event)">📤 Forward</div>';
    }

    contextMenu.innerHTML = menuItems;

    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';

    document.body.appendChild(contextMenu);

    // Remove context menu when clicking elsewhere
    setTimeout(() => {
        document.addEventListener('click', function removeMenu() {
            contextMenu.remove();
            document.removeEventListener('click', removeMenu);
        });
    }, 100);
}

// Additional helper functions
function uploadAvatar() {
    const fileInput = document.getElementById('avatar-input');
    const file = fileInput.files[0];

    if (!file) return;

    const formData = new FormData();
    formData.append('avatar', file);

    fetch('/upload_avatar', {
        method: 'POST',
        body: formData
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('✅ Avatar updated successfully', 'success');
            document.getElementById('settings-avatar').src = data.avatar_url;
        } else {
            showNotification('❌ ' + (data.error || 'Failed to upload avatar'), 'error');
        }
    })
    .catch(error => {
        console.error('Failed to upload avatar:', error);
        showNotification('❌ Error uploading avatar', 'error');
    });
}

function changeNickname() {
    const newNickname = document.getElementById('new-nickname').value.trim();

    if (!newNickname) {
        showNotification('❌ Please enter a new nickname', 'error');
        return;
    }

    fetch('/change_nickname', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({new_nickname: newNickname})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('✅ Nickname changed successfully', 'success');
            nickname = newNickname;
            location.reload();
        } else {
            showNotification('❌ ' + (data.error || 'Failed to change nickname'), 'error');
        }
    })
    .catch(error => {
        console.error('Failed to change nickname:', error);
        showNotification('❌ Error changing nickname', 'error');
    });
}

function updateBio() {
    const bio = document.getElementById('bio-input').value.trim();

    fetch('/update_profile', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({bio: bio})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification('✅ Bio updated successfully', 'success');
        } else {
            showNotification('❌ ' + (data.error || 'Failed to update bio'), 'error');
        }
    })
    .catch(error => {
        console.error('Failed to update bio:', error);
        showNotification('❌ Error updating bio', 'error');
    });
}

function logout() {
    fetch('/logout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            window.location.href = data.redirect;
        }
    })
    .catch(error => {
        console.error('Logout error:', error);
        window.location.href = '/';
    });
}

function confirmDeleteAccount() {
    if (confirm('Are you sure you want to delete your account? This action cannot be undone.')) {
        fetch('/delete_account', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = data.redirect;
            } else {
                showNotification('❌ Failed to delete account', 'error');
            }
        })
        .catch(error => {
            console.error('Delete account error:', error);
            showNotification('❌ Error deleting account', 'error');
        });
    }
}

// Global functions for HTML onclick handlers
window.toggleAdminPanel = toggleAdminPanel;
window.showSettings = showSettings;
window.switchTheme = function(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
};

// Theme initialization
document.addEventListener('DOMContentLoaded', function() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
});

// Helper functions for other features
function updateUserAvatar(username, avatarUrl) {
    // Update avatar in messages and user lists
    document.querySelectorAll(`[data-user="${username}"] .avatar`).forEach(avatar => {
        avatar.src = avatarUrl;
    });
}

function updateOnlineUsersList(users) {
    // Update online users display
    console.log('Online users updated:', users);
}

function handleUserActivityUpdate(data) {
    console.log('User activity update:', data);
    // Handle user status changes
}

function updateUnreadCount(room) {
    // Update unread message counts
    const unreadElement = document.getElementById(`unread-${room}`);
    if (unreadElement && room !== currentRoom) {
        const currentCount = parseInt(unreadElement.textContent) || 0;
        unreadElement.textContent = currentCount + 1;
        unreadElement.style.display = 'block';
    }
}
function appendMessage(type, user, message) {
    const messagesDiv = document.getElementById('messages');
    if (!messagesDiv) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'message';

    if (type === 'system') {
        messageDiv.classList.add('system-message');
    } else if (type === 'own') {
        messageDiv.classList.add('own-message');
    }

    messageDiv.innerHTML = `
        <div class="message-header">
            <span class="message-author">${user}</span>
        </div>
        <div class="message-content">${message}</div>
    `;

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function startAutoRefresh() {
    // Placeholder
}

function updateUserStatusPeriodically() {
    // Placeholder
}

function updateChatListStatus() {
    // Placeholder
}

function updateUsersList() {
    // Placeholder
}

function loadChatList() {
    // Placeholder
}

function deleteMessage() {
    // Placeholder
}

function hideMessage() {
    // Placeholder
}

function forwardMessage() {
    // Placeholder
}

function openImageModal() {
    // Placeholder
}

// Auto-refresh functionality
function startAutoRefresh() {
    // Placeholder
}

function updateUserStatusPeriodically() {
    // Placeholder
}

function updateChatListStatus() {
    // Placeholder
}

function updateUsersList() {
    // Placeholder
}
const userInfo = document.querySelector('.user-info');
    if (userInfo) {
        // Load user avatar
        fetch(`/get_user_avatar/${nickname}`)
            .then(r => r.json())
            .then(data => {
                const userAvatar = document.createElement('img');
                userAvatar.className = 'user-info-avatar';
                userAvatar.src = data.avatar && data.avatar !== '/static/default-avatar.png' ? data.avatar + '?t=' + Date.now() : '/static/default-avatar.svg';
                userAvatar.alt = nickname;
                userAvatar.onerror = () => {
                    userAvatar.src = '/static/default-avatar.svg';
                };

                userInfo.insertBefore(userAvatar, userInfo.firstChild);
            })
            .catch(err => {
                console.error('Failed to load user avatar:', err);
                const userAvatar = document.createElement('img');
                userAvatar.className = 'user-info-avatar';
                userAvatar.src = '/static/default-avatar.svg';
                userAvatar.alt = nickname;
                userInfo.insertBefore(userAvatar, userInfo.firstChild);
            });
    }
     function uploadFile(file) {
        // Placeholder
    }