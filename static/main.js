
document.addEventListener('DOMContentLoaded', () => {
  if (!nickname) return;
  
  const socket = io();
  const chatList = document.getElementById('chat-list');
  const messagesDiv = document.getElementById('messages');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const currentRoomEl = document.getElementById('current-room');
  const roomTypeEl = document.getElementById('room-type');
  const deleteRoomBtn = document.getElementById('delete-room-btn');
  const blockUserBtn = document.getElementById('block-user-btn');
  const userSearch = document.getElementById('user-search');
  const newChatBtn = document.getElementById('new-chat-btn');
  const themeToggle = document.getElementById('theme-toggle');
  const menuToggle = document.getElementById('menu-toggle');
  const sidebar = document.querySelector('.sidebar');
  const createGroupBtn = document.getElementById('create-group-btn');
  
  let currentRoom = 'general';
  let messageHistory = JSON.parse(localStorage.getItem('messageHistory') || '{}');
  let userList = [];
  let filteredUsers = [];
  let searchTimeout;
  
  // Theme management
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', savedTheme);
  
  // Update theme toggle icon
  function updateThemeIcon() {
    const theme = document.body.getAttribute('data-theme');
    if (themeToggle) {
      themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }
  
  updateThemeIcon();
  
  // Theme toggle
  if (themeToggle) {
    themeToggle.onclick = () => {
      const body = document.body;
      const theme = body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      body.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      updateThemeIcon();
    };
  }
  
  // Mobile menu toggle
  if (menuToggle) {
    menuToggle.onclick = () => {
      sidebar.classList.toggle('open');
    };
  }
  
  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 && sidebar.classList.contains('open')) {
      if (!sidebar.contains(e.target) && !menuToggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    }
  });
  
  // Anti-spam protection
  let lastMessageTime = 0;
  const SPAM_THRESHOLD = 1500; // 1.5 seconds between messages
  
  // User search with debounce
  function searchUsers() {
    const query = userSearch.value.trim();
    if (query.length < 2) {
      filteredUsers = [];
      return;
    }
    
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetch(`/search_users?q=${encodeURIComponent(query)}`)
        .then(r => r.json())
        .then(users => {
          filteredUsers = users;
          showUserSuggestions();
        })
        .catch(err => console.error('Search failed:', err));
    }, 300);
  }
  
  function showUserSuggestions() {
    // Remove existing suggestions
    const existing = document.querySelector('.user-suggestions');
    if (existing) existing.remove();
    
    if (filteredUsers.length === 0) return;
    
    const suggestions = document.createElement('div');
    suggestions.className = 'user-suggestions';
    suggestions.innerHTML = filteredUsers.map(user => 
      `<div class="suggestion-item" data-user="${user}">👤 ${user}</div>`
    ).join('');
    
    userSearch.parentNode.appendChild(suggestions);
    
    // Add click handlers
    suggestions.querySelectorAll('.suggestion-item').forEach(item => {
      item.onclick = () => {
        userSearch.value = item.dataset.user;
        suggestions.remove();
        createPrivateChat();
      };
    });
  }
  
  // Create private chat
  function createPrivateChat() {
    const user = userSearch.value.trim();
    if (!user || user === nickname) {
      if (user === nickname) {
        showNotification('❌ You cannot chat with yourself!', 'error');
      }
      return;
    }
    
    fetch('/create_private', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({nick: user})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        loadRooms();
        setTimeout(() => joinRoom(data.room), 100);
        userSearch.value = '';
        const suggestions = document.querySelector('.user-suggestions');
        if (suggestions) suggestions.remove();
      } else {
        showNotification('❌ ' + (data.error || 'Failed to create chat'), 'error');
      }
    })
    .catch(err => {
      console.error('Failed to create private chat:', err);
      showNotification('❌ Error creating chat', 'error');
    });
  }
  
  // Show notification
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
  
  // Load rooms
  function loadRooms() {
    fetch('/rooms')
      .then(r => r.json())
      .then(rooms => {
        chatList.innerHTML = '';
        
        // Add general room first
        const generalLi = document.createElement('li');
        generalLi.className = 'chat-item';
        generalLi.setAttribute('data-room', 'general');
        generalLi.innerHTML = `
          <div class="chat-info">
            <span class="chat-name"># general</span>
            <span class="chat-type">Public</span>
          </div>
          <span class="chat-icon">🌍</span>
        `;
        chatList.appendChild(generalLi);
        
        // Add other rooms
        rooms.forEach(room => {
          if (room !== 'general') {
            const li = document.createElement('li');
            li.className = 'chat-item';
            li.setAttribute('data-room', room);
            
            if (room.startsWith('private_')) {
              const users = room.replace('private_', '').split('_');
              const otherUser = users.find(u => u !== nickname) || users[0];
              li.innerHTML = `
                <div class="chat-info">
                  <span class="chat-name">@ ${otherUser}</span>
                  <span class="chat-type">Private</span>
                </div>
                <span class="chat-icon">🔐</span>
              `;
            } else {
              li.innerHTML = `
                <div class="chat-info">
                  <span class="chat-name"># ${room}</span>
                  <span class="chat-type">Group</span>
                </div>
                <span class="chat-icon">👥</span>
              `;
            }
            chatList.appendChild(li);
          }
        });
        
        // Set active room
        const activeItem = document.querySelector(`[data-room="${currentRoom}"]`);
        if (activeItem) {
          activeItem.classList.add('active');
        }
      })
      .catch(err => console.error('Failed to load rooms:', err));
  }
  
  // Join room
  function joinRoom(room) {
    currentRoom = room;
    
    // Update room display
    if (room.startsWith('private_')) {
      const users = room.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      if (currentRoomEl) currentRoomEl.textContent = `@ ${otherUser}`;
      if (roomTypeEl) roomTypeEl.textContent = 'Private Chat';
    } else if (room === 'general') {
      if (currentRoomEl) currentRoomEl.textContent = '# general';
      if (roomTypeEl) roomTypeEl.textContent = 'Public Chat';
    } else {
      if (currentRoomEl) currentRoomEl.textContent = `# ${room}`;
      if (roomTypeEl) roomTypeEl.textContent = 'Group Chat';
    }
    
    // Update active chat
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`[data-room="${room}"]`);
    if (activeItem) activeItem.classList.add('active');
    
    // Update controls
    if (deleteRoomBtn) {
      deleteRoomBtn.disabled = room === 'general';
    }
    if (blockUserBtn) {
      blockUserBtn.style.display = room.startsWith('private_') ? 'block' : 'none';
    }
    
    // Close mobile menu
    if (window.innerWidth <= 768) {
      sidebar.classList.remove('open');
    }
    
    // Load messages
    loadMessages(room);
    
    // Join socket room
    socket.emit('join', {room, nickname});
  }
  
  function loadMessages(room) {
    fetch(`/messages/${room}`)
      .then(r => r.json())
      .then(messages => {
        messageHistory[room] = messages;
        localStorage.setItem('messageHistory', JSON.stringify(messageHistory));
        displayMessages(messages);
      })
      .catch(err => console.error('Failed to load messages:', err));
  }
  
  function displayMessages(messages) {
    messagesDiv.innerHTML = '';
    messages.forEach((msg, index) => {
      addMessage(msg.nick, msg.text, msg.nick === nickname, false, index);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  function addMessage(nick, text, isOwnMessage = false, isSystemMessage = false, index = -1) {
    const div = document.createElement('div');
    div.className = `message ${isOwnMessage ? 'own' : ''} ${isSystemMessage ? 'system' : ''}`;
    
    if (isSystemMessage) {
      div.innerHTML = `<span class="system-text">${text}</span>`;
    } else {
      div.innerHTML = `
        <div class="message-content">
          <span class="message-author">${nick}</span>
          <span class="message-text">${text}</span>
        </div>
        ${currentRoom !== 'general' && !isOwnMessage && index >= 0 ? 
          `<button class="delete-msg-btn" onclick="deleteMessage(${index})" title="Delete message">🗑️</button>` : ''}
      `;
    }
    
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  // Delete message function (global scope)
  window.deleteMessage = function(index) {
    if (confirm('Delete this message?')) {
      fetch('/delete_message', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom, index: index})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          loadMessages(currentRoom);
        } else {
          showNotification('❌ ' + (data.error || 'Failed to delete message'), 'error');
        }
      })
      .catch(err => {
        console.error('Failed to delete message:', err);
        showNotification('❌ Error deleting message', 'error');
      });
    }
  };
  
  // Event listeners
  if (chatList) {
    chatList.onclick = (e) => {
      const item = e.target.closest('.chat-item');
      if (item) {
        joinRoom(item.getAttribute('data-room'));
      }
    };
  }
  
  if (messageForm) {
    messageForm.onsubmit = (e) => {
      e.preventDefault();
      const message = messageInput.value.trim();
      const now = Date.now();
      
      if (!message) return;
      
      // Anti-spam check
      if (currentRoom === 'general' && now - lastMessageTime < SPAM_THRESHOLD) {
        showNotification('⚠️ Slow down! Anti-spam protection active.', 'warning');
        return;
      }
      
      socket.emit('message', {room: currentRoom, nickname, message});
      messageInput.value = '';
      lastMessageTime = now;
    };
  }
  
  if (newChatBtn) {
    newChatBtn.onclick = createPrivateChat;
  }
  
  if (userSearch) {
    userSearch.oninput = searchUsers;
    userSearch.onkeypress = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createPrivateChat();
      }
    };
  }
  
  if (deleteRoomBtn) {
    deleteRoomBtn.onclick = () => {
      if (currentRoom === 'general') return;
      
      const roomName = currentRoom.startsWith('private_') ? 'private chat' : 'group';
      if (confirm(`🗑️ Delete this ${roomName}? This action cannot be undone.`)) {
        fetch('/delete_room', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({room: currentRoom})
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            delete messageHistory[currentRoom];
            localStorage.setItem('messageHistory', JSON.stringify(messageHistory));
            loadRooms();
            setTimeout(() => joinRoom('general'), 100);
            showNotification('✅ Room deleted successfully', 'success');
          } else {
            showNotification('❌ ' + (data.error || 'Failed to delete room'), 'error');
          }
        })
        .catch(err => {
          console.error('Failed to delete room:', err);
          showNotification('❌ Error deleting room', 'error');
        });
      }
    };
  }
  
  if (blockUserBtn) {
    blockUserBtn.onclick = () => {
      if (confirm('🚫 Block this user? They will be blocked from messaging you.')) {
        fetch('/block_user', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({room: currentRoom})
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            showNotification('✅ User blocked successfully', 'success');
          } else {
            showNotification('❌ Failed to block user', 'error');
          }
        })
        .catch(err => {
          console.error('Failed to block user:', err);
          showNotification('❌ Error blocking user', 'error');
        });
      }
    };
  }
  
  // Socket event handlers
  socket.on('message', (msg) => {
    // Parse message
    const colonIndex = msg.indexOf(':');
    if (colonIndex > 0) {
      const nick = msg.substring(0, colonIndex);
      const text = msg.substring(colonIndex + 1).trim();
      
      // Don't add if it's our own message (avoid duplicates)
      if (nick !== nickname) {
        addMessage(nick, text, false);
        
        // Update cache
        if (!messageHistory[currentRoom]) messageHistory[currentRoom] = [];
        messageHistory[currentRoom].push({nick, text});
        localStorage.setItem('messageHistory', JSON.stringify(messageHistory));
      }
    }
  });
  
  socket.on('error', (data) => {
    showNotification('❌ ' + data.message, 'error');
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('open');
    }
  });
  
  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) {
      const suggestions = document.querySelector('.user-suggestions');
      if (suggestions) suggestions.remove();
    }
  });
  
  // Initial setup
  loadRooms();
  setTimeout(() => joinRoom('general'), 100);
});
