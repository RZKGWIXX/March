document.addEventListener('DOMContentLoaded', () => {
  // Check if we're on the login page - if so, don't initialize chat functionality
  if (!nickname || nickname.trim() === '') return;

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

  // If essential elements don't exist, we're probably on the wrong page
  if (!chatList || !messagesDiv) return;

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
  } else {
    // If no theme toggle button, still apply saved theme
    updateThemeIcon();
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
      updateUserStatus(otherUser);
    } else if (room === 'general') {
      if (currentRoomEl) currentRoomEl.textContent = '# general';
      if (roomTypeEl) roomTypeEl.textContent = 'Public Chat';
      updateRoomStats(room);
    } else {
      if (currentRoomEl) currentRoomEl.textContent = `# ${room}`;
      if (roomTypeEl) roomTypeEl.textContent = 'Group Chat';
      updateRoomStats(room);
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
      `;
      
      // Add context menu for message deletion
      if (index >= 0) {
        div.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showMessageContextMenu(e, index, nick, isOwnMessage);
        });
        
        // Mobile long press
        let pressTimer;
        div.addEventListener('touchstart', (e) => {
          pressTimer = setTimeout(() => {
            showMessageContextMenu(e.touches[0], index, nick, isOwnMessage);
          }, 800);
        });
        
        div.addEventListener('touchend', () => {
          clearTimeout(pressTimer);
        });
      }
    }

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // Show context menu for messages
  function showMessageContextMenu(e, index, nick, isOwnMessage) {
    hideContextMenu();
    
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    
    const items = [];
    
    if (isOwnMessage) {
      items.push({text: '🗑️ Delete for me', action: () => deleteMessage(index, 'me')});
      // Allow deletion for everyone in private chats and groups (not just general)
      if (currentRoom !== 'general' || nickname === 'Wixxy') {
        items.push({text: '🗑️ Delete for everyone', action: () => deleteMessage(index, 'all')});
      }
    } else if (nickname === 'Wixxy') {
      items.push({text: '🗑️ Delete message', action: () => deleteMessage(index, 'all')});
      items.push({text: '🚫 Ban user', action: () => showBanDialog(nick)});
    }
    
    // Add clear history option for private chats
    if (currentRoom.startsWith('private_')) {
      items.push({text: '🧹 Clear history for me', action: () => clearPrivateHistory()});
    }
    
    items.forEach(item => {
      const div = document.createElement('div');
      div.className = 'context-item';
      div.textContent = item.text;
      div.onclick = () => {
        hideContextMenu();
        item.action();
      };
      contextMenu.appendChild(div);
    });
    
    document.body.appendChild(contextMenu);
    
    // Hide on click outside
    setTimeout(() => {
      document.addEventListener('click', hideContextMenu);
    }, 0);
  }
  
  // Clear private chat history for current user
  function clearPrivateHistory() {
    if (confirm('Clear chat history for yourself? This cannot be undone.')) {
      fetch('/clear_private_history', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          loadMessages(currentRoom);
          showNotification('✅ History cleared for you', 'success');
        } else {
          showNotification('❌ Failed to clear history', 'error');
        }
      });
    }
  }
  
  function hideContextMenu() {
    const existing = document.querySelector('.context-menu');
    if (existing) {
      existing.remove();
      document.removeEventListener('click', hideContextMenu);
    }
  }
  
  // Delete message function (global scope)
  window.deleteMessage = function(index, type = 'all') {
    const confirmText = type === 'me' ? 'Hide this message for yourself?' : 'Delete this message for everyone?';
    
    if (confirm(confirmText)) {
      fetch('/delete_message', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom, index: index, type: type})
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

      // Add message for everyone (including own messages for real-time display)
      addMessage(nick, text, nick === nickname);

      // Update cache
      if (!messageHistory[currentRoom]) messageHistory[currentRoom] = [];
      messageHistory[currentRoom].push({nick, text});
      localStorage.setItem('messageHistory', JSON.stringify(messageHistory));
      
      // Show notification and sound only for others' messages
      if (nick !== nickname) {
        if (document.hidden) {
          showDesktopNotification(nick, text);
        }
        playNotificationSound();
      }
    }
  });

  socket.on('error', (data) => {
    showNotification('❌ ' + data.message, 'error');
  });
  
  socket.on('chat_cleared', (data) => {
    if (data.room === currentRoom) {
      messagesDiv.innerHTML = '';
      showNotification('💬 Chat was cleared by admin', 'info');
    }
  });
  
  socket.on('user_banned', (data) => {
    if (data.username === nickname) {
      showNotification(`🚫 You have been banned: ${data.reason}`, 'error');
      setTimeout(() => {
        window.location.href = '/';
      }, 3000);
    }
  });
  
  socket.on('message_deleted', (data) => {
    if (data.room === currentRoom) {
      loadMessages(currentRoom);
    }
  });
  
  // Desktop notifications
  function showDesktopNotification(nick, text) {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(`${nick} in ${currentRoom}`, {
        body: text,
        icon: '/static/favicon.ico'
      });
    }
  }
  
  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  // Play notification sound
  function playNotificationSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  }

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

  // Show ban dialog
  function showBanDialog(username) {
    const modal = document.createElement('div');
    modal.className = 'ban-modal';
    modal.innerHTML = `
      <div class="ban-dialog">
        <h3>🚫 Ban User: ${username}</h3>
        <input type="text" id="ban-reason" placeholder="Ban reason" required>
        <select id="ban-duration">
          <option value="1">1 Hour</option>
          <option value="24">24 Hours</option>
          <option value="168">1 Week</option>
          <option value="720">1 Month</option>
          <option value="-1">Permanent</option>
        </select>
        <div class="ban-buttons">
          <button class="cancel-btn" onclick="this.closest('.ban-modal').remove()">Cancel</button>
          <button class="ban-btn" onclick="banUser('${username}')">Ban User</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  // Ban user
  window.banUser = function(username) {
    const reason = document.getElementById('ban-reason').value.trim();
    const duration = parseInt(document.getElementById('ban-duration').value);
    
    if (!reason) {
      showNotification('❌ Please provide a ban reason', 'error');
      return;
    }
    
    fetch('/admin/ban_user', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, reason, duration})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ User banned successfully', 'success');
        document.querySelector('.ban-modal').remove();
      } else {
        showNotification('❌ ' + (data.error || 'Failed to ban user'), 'error');
      }
    })
    .catch(err => {
      console.error('Failed to ban user:', err);
      showNotification('❌ Error banning user', 'error');
    });
  };
  
  // Admin panel
  window.toggleAdminPanel = function() {
    if (nickname !== 'Wixxy') {
      showNotification('❌ Access denied', 'error');
      return;
    }
    
    const modal = document.createElement('div');
    modal.className = 'admin-panel';
    modal.innerHTML = `
      <div class="admin-content">
        <h2>🔧 Admin Panel</h2>
        <div id="admin-stats" class="admin-stats"></div>
        <button class="admin-btn" onclick="loadStats()">📊 View Statistics</button>
        <button class="admin-btn" onclick="createGroupAsAdmin()">Create Group</button>
        <button class="admin-btn" onclick="loadBannedUsers()">View Banned Users</button>
        <button class="admin-btn" onclick="clearChat()">Clear General Chat</button>
        <button class="admin-btn" onclick="loadAllUsers()">Ban User</button>
        <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Close</button>
        <div id="admin-content-area"></div>
      </div>
    `;
    document.body.appendChild(modal);
    loadStats(); // Load stats immediately
  };
  
  // Create group as admin
  window.createGroupAsAdmin = function() {
    const groupName = prompt('Enter group name:');
    if (groupName && groupName.trim()) {
      fetch('/create_group', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: groupName.trim()})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          loadRooms();
          showNotification('✅ Group created successfully', 'success');
        } else {
          showNotification('❌ ' + (data.error || 'Failed to create group'), 'error');
        }
      });
    }
  };
  
  // Load statistics
  window.loadStats = function() {
    fetch('/admin/stats')
      .then(r => r.json())
      .then(data => {
        const statsDiv = document.getElementById('admin-stats');
        statsDiv.innerHTML = `
          <div class="stats-grid">
            <div class="stat-item">
              <h3>👥 Total Users</h3>
              <div class="stat-number">${data.total_users}</div>
            </div>
            <div class="stat-item">
              <h3>🟢 Online Users</h3>
              <div class="stat-number">${data.online_users}</div>
            </div>
          </div>
          <div class="online-users-list">
            <h4>Online Users:</h4>
            ${data.online_list.map(user => `
              <div class="online-user">
                <span class="user-name">${user.nickname}</span>
                <span class="user-room">in ${user.room}</span>
                <span class="online-indicator">🟢</span>
              </div>
            `).join('') || '<p>No users online</p>'}
          </div>
        `;
      })
      .catch(err => console.error('Failed to load stats:', err));
  };
  
  // Load all users for banning
  window.loadAllUsers = function() {
    fetch('/users')
      .then(r => r.json())
      .then(users => {
        const area = document.getElementById('admin-content-area');
        area.innerHTML = '<h3>Select User to Ban:</h3>' + 
          users.map(user => `
            <div class="user-item">
              <span>${user}</span>
              <button class="ban-btn" onclick="showBanDialog('${user}')">Ban</button>
            </div>
          `).join('');
      });
  };
  
  // Load banned users
  window.loadBannedUsers = function() {
    fetch('/admin/banned_users')
      .then(r => r.json())
      .then(data => {
        const list = document.getElementById('banned-users-list');
        if (data.banned && data.banned.length > 0) {
          list.innerHTML = '<h3>Banned Users:</h3>' + 
            data.banned.map(ban => `
              <div class="ban-item">
                <strong>${ban.username}</strong> (${ban.ip})<br>
                Reason: ${ban.reason}<br>
                Until: ${ban.until}<br>
                <button class="unban-btn" onclick="unbanUser('${ban.username}')">Unban</button>
              </div>
            `).join('');
        } else {
          list.innerHTML = '<p>No banned users</p>';
        }
      });
  };
  
  // Unban user
  window.unbanUser = function(username) {
    fetch('/admin/unban_user', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ User unbanned successfully', 'success');
        loadBannedUsers();
      } else {
        showNotification('❌ Failed to unban user', 'error');
      }
    });
  };
  
  // Clear chat
  window.clearChat = function() {
    if (confirm('Clear all messages in general chat?')) {
      fetch('/admin/clear_chat', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: 'general'})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          showNotification('✅ Chat cleared successfully', 'success');
          loadMessages('general');
        }
      });
    }
  };

  // Update user status for private chats
  function updateUserStatus(username) {
    fetch(`/user_status/${username}`)
      .then(r => r.json())
      .then(data => {
        const statusEl = document.getElementById('user-status');
        if (statusEl) statusEl.remove();
        
        const chatHeader = document.querySelector('.chat-header');
        const statusDiv = document.createElement('div');
        statusDiv.id = 'user-status';
        statusDiv.className = 'user-status';
        
        if (data.status === 'online') {
          statusDiv.innerHTML = '<span class="status-indicator online">🟢</span> Online';
        } else {
          const lastSeen = data.last_seen ? new Date(data.last_seen * 1000).toLocaleString() : 'Unknown';
          statusDiv.innerHTML = `<span class="status-indicator offline">⚪</span> Last seen: ${lastSeen}`;
        }
        
        chatHeader.appendChild(statusDiv);
      })
      .catch(err => console.error('Failed to get user status:', err));
  }
  
  // Update room statistics
  function updateRoomStats(room) {
    fetch(`/room_stats/${room}`)
      .then(r => r.json())
      .then(data => {
        const statusEl = document.getElementById('room-stats');
        if (statusEl) statusEl.remove();
        
        const chatHeader = document.querySelector('.chat-header');
        const statsDiv = document.createElement('div');
        statsDiv.id = 'room-stats';
        statsDiv.className = 'room-stats';
        statsDiv.innerHTML = `<span class="stats-text">👥 ${data.online_count}/${data.total_count} online</span>`;
        
        chatHeader.appendChild(statsDiv);
      })
      .catch(err => console.error('Failed to get room stats:', err));
  }
  
  // Listen for user count updates
  socket.on('user_count_update', () => {
    if (currentRoom.startsWith('private_')) {
      const users = currentRoom.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      updateUserStatus(otherUser);
    } else {
      updateRoomStats(currentRoom);
    }
  });

  // Initial setup
  loadRooms();
  setTimeout(() => joinRoom('general'), 100);
  
  // Add admin button to header if admin
  if (nickname === 'Wixxy') {
    const headerButtons = document.querySelector('.header-buttons');
    if (headerButtons) {
      const adminBtn = document.createElement('button');
      adminBtn.innerHTML = '🔧';
      adminBtn.title = 'Admin Panel';
      adminBtn.onclick = toggleAdminPanel;
      headerButtons.appendChild(adminBtn);
    }
  }
  
  // Add create group button
  if (createGroupBtn) {
    createGroupBtn.onclick = () => {
      const groupName = prompt('Enter group name:');
      if (groupName && groupName.trim()) {
        fetch('/create_group', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name: groupName.trim()})
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            loadRooms();
            setTimeout(() => joinRoom(data.room), 100);
            showNotification('✅ Group created successfully', 'success');
          } else {
            showNotification('❌ ' + (data.error || 'Failed to create group'), 'error');
          }
        })
        .catch(err => {
          console.error('Failed to create group:', err);
          showNotification('❌ Error creating group', 'error');
        });
      }
    };
  }
});