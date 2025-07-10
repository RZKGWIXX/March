
document.addEventListener('DOMContentLoaded', () => {
  if (!nickname) return; // Exit if not logged in
  
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
  
  let currentRoom = 'general';
  let messageHistory = {};
  let lastMessageCount = {};
  
  // Theme toggle
  themeToggle.onclick = () => {
    const body = document.body;
    const theme = body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  };
  
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
  
  // Load saved theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', savedTheme);
  
  // Anti-spam protection
  let lastMessageTime = 0;
  const SPAM_THRESHOLD = 2000; // 2 seconds between messages
  
  // Load rooms
  function loadRooms() {
    fetch('/rooms')
      .then(r => r.json())
      .then(rooms => {
        chatList.innerHTML = '';
        
        // Add general room first
        const generalLi = document.createElement('li');
        generalLi.className = 'chat-item active';
        generalLi.setAttribute('data-room', 'general');
        generalLi.innerHTML = `
          <span class="chat-name"># general</span>
          <span class="chat-lock">🔒</span>
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
                <span class="chat-name">@ ${otherUser}</span>
                <span class="chat-lock">🔐</span>
              `;
            } else {
              li.innerHTML = `
                <span class="chat-name"># ${room}</span>
                <span class="chat-lock">👥</span>
              `;
            }
            chatList.appendChild(li);
          }
        });
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
      currentRoomEl.textContent = `@ ${otherUser}`;
      roomTypeEl.textContent = 'Private Chat';
    } else if (room === 'general') {
      currentRoomEl.textContent = '# general';
      roomTypeEl.textContent = 'Public Group (Protected)';
    } else {
      currentRoomEl.textContent = `# ${room}`;
      roomTypeEl.textContent = 'Group Chat';
    }
    
    // Update active chat
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`[data-room="${room}"]`);
    if (activeItem) activeItem.classList.add('active');
    
    // Enable/disable delete button
    deleteRoomBtn.disabled = room === 'general';
    
    // Close mobile menu
    if (window.innerWidth <= 768) {
      sidebar.classList.remove('open');
    }
    
    // Load messages if not cached or if new messages arrived
    if (!messageHistory[room] || needsMessageUpdate(room)) {
      loadMessages(room);
    } else {
      displayMessages(messageHistory[room]);
    }
    
    // Join socket room
    socket.emit('join', {room, nickname});
  }
  
  function needsMessageUpdate(room) {
    return !lastMessageCount[room] || lastMessageCount[room] !== (messageHistory[room]?.length || 0);
  }
  
  function loadMessages(room) {
    fetch(`/messages/${room}`)
      .then(r => r.json())
      .then(messages => {
        messageHistory[room] = messages;
        lastMessageCount[room] = messages.length;
        displayMessages(messages);
      })
      .catch(err => console.error('Failed to load messages:', err));
  }
  
  function displayMessages(messages) {
    messagesDiv.innerHTML = '';
    messages.forEach(msg => {
      addMessage(msg.nick, msg.text, msg.nick === nickname);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  function addMessage(nick, text, isOwnMessage = false, isSystemMessage = false) {
    const div = document.createElement('div');
    div.className = `message ${isOwnMessage ? 'own' : ''} ${isSystemMessage ? 'system' : ''}`;
    
    if (isSystemMessage) {
      div.textContent = text;
    } else {
      div.textContent = `${nick}: ${text}`;
    }
    
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  // Chat list click handler
  chatList.onclick = (e) => {
    const item = e.target.closest('.chat-item');
    if (item) {
      joinRoom(item.getAttribute('data-room'));
    }
  };
  
  // Message form submit
  messageForm.onsubmit = (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    const now = Date.now();
    
    if (!message) return;
    
    // Anti-spam check for general room
    if (currentRoom === 'general' && now - lastMessageTime < SPAM_THRESHOLD) {
      alert('⚠️ Slow down! Anti-spam protection active.');
      return;
    }
    
    if (message) {
      socket.emit('message', {room: currentRoom, nickname, message});
      messageInput.value = '';
      lastMessageTime = now;
      
      // Update local cache
      if (!messageHistory[currentRoom]) messageHistory[currentRoom] = [];
      messageHistory[currentRoom].push({nick: nickname, text: message});
    }
  };
  
  // New chat button
  newChatBtn.onclick = () => {
    const user = userSearch.value.trim();
    if (user && user !== nickname) {
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
        } else {
          alert('❌ Failed to create private chat');
        }
      })
      .catch(err => {
        console.error('Failed to create private chat:', err);
        alert('❌ Error creating private chat');
      });
      userSearch.value = '';
    } else if (user === nickname) {
      alert('❌ You cannot create a chat with yourself!');
    }
  };
  
  // Delete room button
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
          delete lastMessageCount[currentRoom];
          loadRooms();
          setTimeout(() => joinRoom('general'), 100);
        } else {
          alert('❌ ' + (data.error || 'Failed to delete room'));
        }
      })
      .catch(err => {
        console.error('Failed to delete room:', err);
        alert('❌ Error deleting room');
      });
    }
  };
  
  // Block user button
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
          alert('✅ User blocked successfully');
        } else {
          alert('❌ Failed to block user');
        }
      })
      .catch(err => {
        console.error('Failed to block user:', err);
        alert('❌ Error blocking user');
      });
    }
  };
  
  // Socket message handler
  socket.on('message', (msg) => {
    // Don't show "joined" messages for better UX
    if (msg.includes('[SYSTEM]') && msg.includes('joined')) {
      return;
    }
    
    // Parse message to determine if it's system or user message
    if (msg.includes('[SYSTEM]')) {
      addMessage('', msg.replace('[SYSTEM]', '').trim(), false, true);
    } else {
      // Extract nick and message
      const colonIndex = msg.indexOf(':');
      if (colonIndex > 0) {
        const nick = msg.substring(0, colonIndex);
        const text = msg.substring(colonIndex + 1).trim();
        addMessage(nick, text, nick === nickname);
        
        // Update cache
        if (!messageHistory[currentRoom]) messageHistory[currentRoom] = [];
        messageHistory[currentRoom].push({nick, text});
      }
    }
  });
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768) {
      sidebar.classList.remove('open');
    }
  });
  
  // Enter key for search
  userSearch.onkeypress = (e) => {
    if (e.key === 'Enter') {
      newChatBtn.click();
    }
  };
  
  // Initial setup
  loadRooms();
  setTimeout(() => joinRoom('general'), 100);
});
