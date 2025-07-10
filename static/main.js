document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
  let currentRoom = 'general';
  const chatList = document.getElementById('chat-list');
  const messagesEl = document.getElementById('messages');
  const msgForm = document.getElementById('message-form');
  const msgInput = document.getElementById('message-input');
  const roomTitle = document.getElementById('current-room');
  const deleteBtn = document.getElementById('delete-room-btn');
  const blockBtn = document.getElementById('block-user-btn');
  // Theme toggle
  document.getElementById('theme-toggle').onclick = () => {
    document.body.dataset.theme = document.body.dataset.theme === 'light' ? 'dark' : 'light';
  };
  // Load rooms
  fetch('/rooms').then(r => r.json()).then(rooms => {
    rooms.forEach(rn => {
      if (rn !== 'general') {
        addChatItem(rn);
      }
    });
  });
  function addChatItem(room) {
    const li = document.createElement('li');
    li.className = 'chat-item';
    li.dataset.room = room;
    li.textContent = room;
    chatList.appendChild(li);
  }
  // Join room
  chatList.addEventListener('click', e => {
    const li = e.target.closest('.chat-item');
    if (!li) return;
    chatList.querySelectorAll('.chat-item').forEach(x => x.classList.remove('active'));
    li.classList.add('active');
    currentRoom = li.dataset.room || 'general';
    roomTitle.textContent = `# ${currentRoom}`;
    deleteBtn.disabled = currentRoom==='general';
    messagesEl.innerHTML = '';
    // Load past messages
    fetch(`/messages/${currentRoom}`).then(r=>r.json()).then(msgs => {
      msgs.forEach(m=>addMessage(`${m.nick}: ${m.text}`, m.nick===nickname));
    });
    socket.emit('join',{room:currentRoom,nickname});
  });
  // Send message
  msgForm.onsubmit = e => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit('message',{room:currentRoom,nickname,message:text});
    addMessage(`${nickname}: ${text}`, true);
    msgInput.value='';
  };
  socket.on('message', msg => {
    addMessage(msg, msg.startsWith(nickname+':'));
  });
  function addMessage(text, own) {
    const d = document.createElement('div');
    d.className='message'+(own?' own':'');
    d.textContent=text;
    messagesEl.appendChild(d);
    messagesEl.scrollTop=messagesEl.scrollHeight;
  }
  // Create new private chat
  document.getElementById('new-chat-btn').onclick = () => {
    const nick = document.getElementById('user-search').value.trim();
    if (!nick) return alert('Enter nickname');
    fetch('/create_private',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nick})})
      .then(r=>r.json()).then(j=>addChatItem(j.room));
  };
  // Delete room
  deleteBtn.onclick = () => {
    fetch('/delete_room',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:currentRoom})})
      .then(res=>res.ok && location.reload());
  };
  // Block user
  blockBtn.onclick = () => {
    fetch('/block_user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:currentRoom})})
      .then(()=>alert('Blocked'));
  };
  // Initial join
  chatList.querySelector('.chat-item').click();
});