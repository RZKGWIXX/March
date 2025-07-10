
document.addEventListener('DOMContentLoaded', () => {
  if (!nickname) return; // Exit if not logged in
  
  const socket = io();
  const chatList = document.getElementById('chat-list');
  const messagesDiv = document.getElementById('messages');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');
  const currentRoomEl = document.getElementById('current-room');
  const deleteRoomBtn = document.getElementById('delete-room-btn');
  const blockUserBtn = document.getElementById('block-user-btn');
  const userSearch = document.getElementById('user-search');
  const newChatBtn = document.getElementById('new-chat-btn');
  const themeToggle = document.getElementById('theme-toggle');
  
  let currentRoom = 'general';
  
  // Theme toggle
  themeToggle.onclick = () => {
    const body = document.body;
    const theme = body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  };
  
  // Load saved theme
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', savedTheme);
  
  // Load rooms
  function loadRooms() {
    fetch('/rooms')
      .then(r => r.json())
      .then(rooms => {
        chatList.innerHTML = '<li data-room="general" class="chat-item active"># general 🔒</li>';
        rooms.forEach(room => {
          if (room !== 'general') {
            const li = document.createElement('li');
            li.className = 'chat-item';
            li.setAttribute('data-room', room);
            li.textContent = room.startsWith('private_') ? `@ ${room.split('_').pop()}` : `# ${room}`;
            chatList.appendChild(li);
          }
        });
      });
  }
  
  // Join room
  function joinRoom(room) {
    currentRoom = room;
    currentRoomEl.textContent = room.startsWith('private_') ? `@ ${room.split('_').pop()}` : `# ${room}`;
    
    // Update active chat
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    document.querySelector(`[data-room="${room}"]`).classList.add('active');
    
    // Enable/disable delete button
    deleteRoomBtn.disabled = room === 'general';
    
    // Load messages
    fetch(`/messages/${room}`)
      .then(r => r.json())
      .then(messages => {
        messagesDiv.innerHTML = '';
        messages.forEach(msg => {
          const div = document.createElement('div');
          div.className = `message ${msg.nick === nickname ? 'own' : ''}`;
          div.textContent = `${msg.nick}: ${msg.text}`;
          messagesDiv.appendChild(div);
        });
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      });
    
    // Join socket room
    socket.emit('join', {room, nickname});
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
    if (message) {
      socket.emit('message', {room: currentRoom, nickname, message});
      messageInput.value = '';
    }
  };
  
  // New chat button
  newChatBtn.onclick = () => {
    const user = userSearch.value.trim();
    if (user) {
      fetch('/create_private', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({nick: user})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          loadRooms();
          joinRoom(data.room);
        }
      });
      userSearch.value = '';
    }
  };
  
  // Delete room button
  deleteRoomBtn.onclick = () => {
    if (confirm('Delete this room?')) {
      fetch('/delete_room', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          loadRooms();
          joinRoom('general');
        }
      });
    }
  };
  
  // Block user button
  blockUserBtn.onclick = () => {
    fetch('/block_user', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: currentRoom})
    })
    .then(() => alert('Blocked'));
  };
  
  // Socket message handler
  socket.on('message', (msg) => {
    const div = document.createElement('div');
    div.className = 'message';
    div.textContent = msg;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
  
  // Initial setup
  loadRooms();
  joinRoom('general');
});
