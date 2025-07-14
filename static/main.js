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

  // Debug logging
  console.log('Chat list element:', chatList);
  console.log('Messages div:', messagesDiv);
  console.log('Nickname:', nickname);

  // If essential elements don't exist, we're probably on the wrong page
  if (!chatList || !messagesDiv) {
    console.error('Essential elements not found - chat list or messages div missing');
    return;
  }

  let currentRoom = 'general';
  let messageHistory = JSON.parse(localStorage.getItem('messageHistory') || '{}');
  let userList = [];
  let filteredUsers = [];
  let searchTimeout;
  let useMobileInterface = window.innerWidth <= 768;

  // Force dark theme only
  document.body.setAttribute('data-theme', 'dark');
  localStorage.setItem('theme', 'dark');

  // Theme toggle opens settings
  if (themeToggle) {
    themeToggle.onclick = () => {
      showSettings();
    };
  }

  // Mobile menu toggle - show mobile sidebar instead
  if (menuToggle) {
    menuToggle.onclick = () => {
      showMobileSidebar();
    };
  }

  // Header menu toggle for sidebar
  const menuToggleHeader = document.getElementById('menu-toggle-header');
  if (menuToggleHeader) {
    menuToggleHeader.onclick = () => {
      showMobileSidebar();
    };
  }

  // Mobile sidebar functionality
  function showMobileSidebar() {
    // Remove existing sidebar
    const existingSidebar = document.querySelector('.mobile-sidebar');
    if (existingSidebar) {
      existingSidebar.remove();
    }

    const mobileSidebar = document.createElement('div');
    mobileSidebar.className = 'mobile-sidebar';
    
    checkPremium().then(premiumInfo => {
      mobileSidebar.innerHTML = `
        <div class="mobile-sidebar-header">
          <h2>💬 OrbitMess</h2>
          <button class="close-sidebar-btn" onclick="closeMobileSidebar()">×</button>
        </div>
        
        <button class="mobile-sidebar-item" onclick="showSettings(); closeMobileSidebar();">
          <span class="icon">⚙️</span>
          <span>Налаштування</span>
        </button>
        
        ${premiumInfo.premium ? '' : `
        <button class="mobile-sidebar-item" onclick="showPremiumPurchase(); closeMobileSidebar();">
          <span class="icon">⭐</span>
          <span>Купити Premium</span>
        </button>
        `}
        
        ${nickname === 'Wixxy' ? `
        <button class="mobile-sidebar-item" onclick="toggleAdminPanel(); closeMobileSidebar();">
          <span class="icon">🔧</span>
          <span>Адмін панель</span>
        </button>
        ` : ''}
        
        <button class="mobile-sidebar-item" onclick="showPrivacySettings(); closeMobileSidebar();">
          <span class="icon">🔒</span>
          <span>Конфіденційність</span>
        </button>
        
        <button class="mobile-sidebar-item" onclick="logout(); closeMobileSidebar();">
          <span class="icon">🚪</span>
          <span>Вихід</span>
        </button>
      `;
      
      document.body.appendChild(mobileSidebar);
      
      // Add backdrop
      const backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
      `;
      backdrop.onclick = closeMobileSidebar;
      document.body.appendChild(backdrop);
      
      setTimeout(() => {
        mobileSidebar.classList.add('open');
      }, 10);
    });
  }

  window.closeMobileSidebar = function() {
    const mobileSidebar = document.querySelector('.mobile-sidebar');
    const backdrop = document.querySelector('.sidebar-backdrop');
    
    if (mobileSidebar) {
      mobileSidebar.classList.remove('open');
      setTimeout(() => {
        mobileSidebar.remove();
      }, 300);
    }
    
    if (backdrop) {
      backdrop.remove();
    }
  };

  // Check premium status
  async function checkPremium() {
    try {
      const response = await fetch('/check_premium');
      return await response.json();
    } catch (error) {
      console.error('Failed to check premium:', error);
      return { premium: false };
    }
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
  async function createPrivateChat() {
    try {
      const user = userSearch.value.trim();
      if (!user || user === nickname) {
        if (user === nickname) {
          showNotification('❌ You cannot chat with yourself!', 'error');
        }
        return;
      }

      const data = await safeFetchJson('/create_private', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({nick: user})
      });

      if (data.success) {
        loadRooms();
        setTimeout(() => joinRoom(data.room), 100);
        userSearch.value = '';
        const suggestions = document.querySelector('.user-suggestions');
        if (suggestions) suggestions.remove();
      } else {
        showNotification('❌ ' + (data.error || 'Failed to create chat'), 'error');
      }
    } catch (err) {
      console.error('Failed to create private chat:', err);
      showNotification('❌ Error creating chat', 'error');
    }
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
  async function loadRooms() {
    try {
      const response = await fetch('/rooms');
      const rooms = await response.json();
      console.log('Rooms received:', rooms);

      if (!chatList) {
        console.error('Chat list element not found');
        return;
      }

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
      if (Array.isArray(rooms)) {
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
                  <span class="chat-status" id="status-${otherUser}">Loading...</span>
                </div>
                <span class="chat-icon">🔐</span>
              `;

              // Load user status
              fetch(`/user_status/${otherUser}`)
                .then(r => r.json())
                .then(data => {
                  const statusEl = document.getElementById(`status-${otherUser}`);
                  if (statusEl) {
                    if (data.status === 'online') {
                      statusEl.innerHTML = '🟢 У мережі';
                      statusEl.className = 'chat-status online';
                    } else if (data.last_seen) {
                      const lastSeen = new Date(data.last_seen * 1000);
                      const now = new Date();
                      const diffHours = (now - lastSeen) / (1000 * 60 * 60);
                      const diffDays = Math.floor(diffHours / 24);

                      if (diffDays >= 3) {
                        statusEl.innerHTML = `⚪ Був ${lastSeen.toLocaleDateString('uk-UA')}`;
                      } else if (diffDays >= 1) {
                        statusEl.innerHTML = `⚪ Був ${diffDays} ${diffDays === 1 ? 'день' : 'дні'} тому`;
                      } else {
                        statusEl.innerHTML = `⚪ Був ${lastSeen.toLocaleTimeString('uk-UA', {hour: '2-digit', minute: '2-digit'})}`;
                      }
                      statusEl.className = 'chat-status offline';
                    } else {
                      statusEl.innerHTML = '⚪ Був давно';
                      statusEl.className = 'chat-status offline';
                    }
                  }
                })
                .catch(err => {
                  const statusEl = document.getElementById(`status-${otherUser}`);
                  if (statusEl) {
                    statusEl.innerHTML = '⚪ Невідомо';
                    statusEl.className = 'chat-status offline';
                  }
                });
            } else {
              li.innerHTML = `
                <div class="chat-info">
                  <span class="chat-name"># ${room}</span>
                  <span class="chat-type">Group</span>
                  <span class="chat-status" id="status-${room}">Loading...</span>
                </div>
                <span class="chat-icon">👥</span>
              `;

              // Load room stats
              fetch(`/room_stats/${room}`)
                .then(r => r.json())
                .then(data => {
                  const statusEl = document.getElementById(`status-${room}`);
                  if (statusEl) {
                    statusEl.innerHTML = `👥 ${data.online_count}/${data.total_count} у мережі`;
                    statusEl.className = 'chat-status';
                  }
                })
                .catch(err => {
                  const statusEl = document.getElementById(`status-${room}`);
                  if (statusEl) {
                    statusEl.innerHTML = '👥 Статус невідомий';
                    statusEl.className = 'chat-status';
                  }
                });
            }
            chatList.appendChild(li);
          }
        });
      } else {
        console.error('Rooms is not an array:', rooms);
      }

      // Set active room
      const activeItem = document.querySelector(`[data-room="${currentRoom}"]`);
      if (activeItem) {
        activeItem.classList.add('active');
      }

      console.log('Rooms loaded successfully');
    } catch (err) {
      console.error('Failed to load rooms:', err);
      showNotification('❌ Failed to load rooms', 'error');
    }
  }

  // Join room
  function joinRoom(room) {
    currentRoom = room;

    // Update room display with null checks
    if (room.startsWith('private_')) {
      const users = room.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      if (currentRoomEl) {
        currentRoomEl.textContent = `@ ${otherUser}`;
        currentRoomEl.setAttribute('data-room', room);
      }
      if (roomTypeEl) {
        // Move status between nickname and controls on mobile
        if (useMobileInterface) {
          roomTypeEl.style.display = 'none';
        } else {
          roomTypeEl.textContent = 'Private Chat';
          roomTypeEl.style.display = 'block';
        }
      }
      updateUserStatus(otherUser);
    } else if (room === 'general') {
      if (currentRoomEl) {
        currentRoomEl.textContent = '# general';
        currentRoomEl.setAttribute('data-room', room);
      }
      if (roomTypeEl) {
        if (useMobileInterface) {
          roomTypeEl.style.display = 'none';
        } else {
          roomTypeEl.textContent = 'Public Chat';
          roomTypeEl.style.display = 'block';
        }
      }
      updateRoomStats(room);
    } else {
      if (currentRoomEl) {
        currentRoomEl.textContent = `# ${room}`;
        currentRoomEl.setAttribute('data-room', room);
      }
      if (roomTypeEl) {
        if (useMobileInterface) {
          roomTypeEl.style.display = 'none';
        } else {
          roomTypeEl.textContent = 'Group Chat';
          roomTypeEl.style.display = 'block';
        }
      }
      updateRoomStats(room);
    }

    // Update active chat
    document.querySelectorAll('.chat-item').forEach(item => item.classList.remove('active'));
    const activeItem = document.querySelector(`[data-room="${room}"]`);
    if (activeItem) activeItem.classList.add('active');

    // Update controls - hide all buttons for general chat since we have mobile dropdown
    if (deleteRoomBtn) {
      deleteRoomBtn.style.display = 'none'; // Always hide since we have mobile dropdown
    }
    if (blockUserBtn) {
      blockUserBtn.style.display = 'none'; // Always hide since we have mobile dropdown
    }

    // Settings moved to mobile sidebar, no special handling needed

    // Setup mobile chat options
    const mobileChatOptions = document.getElementById('mobile-chat-options');
    const mobileChatDropdown = document.getElementById('mobile-chat-dropdown');

    if (mobileChatOptions) {
      mobileChatOptions.style.display = 'block'; // Always show for all chats
      // Setup mobile chat dropdown
      setupMobileChatDropdown(room);
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

  async function loadMessages(room) {
    try {
      const messages = await safeFetchJson(`/messages/${room}`);
      messageHistory[room] = messages;
      localStorage.setItem('messageHistory', JSON.stringify(messageHistory));
      displayMessages(messages);
    } catch (err) {
      console.error('Failed to load messages:', err);
      showNotification('❌ Failed to load messages', 'error');
    }
  }

  function displayMessages(messages) {
    messagesDiv.innerHTML = '';
    messages.forEach((msg, index) => {
      addMessage(msg.nick, msg.text, msg.nick === nickname, false, index);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  // Load and display stories
  async function loadStories() {
    try {
      const stories = await safeFetchJson('/get_stories');
      displayStories(stories);
    } catch (err) {
      showNotification('❌ Failed to load stories', 'error');
    }
  }

  function displayStories(stories) {
    // Update header stories (right side)
    const headerStories = document.getElementById('header-stories');
    if (headerStories) {
      headerStories.innerHTML = '';
      
      if (Object.keys(stories).length > 0) {
        Object.entries(stories).forEach(([username, userStories]) => {
          const storyItem = document.createElement('div');
          storyItem.className = 'header-story-item';
          
          const remainingCount = Math.max(0, userStories.length - 3);
          
          storyItem.innerHTML = `
            <img src="/static/default-avatar.svg" alt="${username}" class="header-story-avatar" data-username="${username}">
            <div class="header-story-username">${username}</div>
            ${remainingCount > 0 ? `<div class="header-story-count">+${remainingCount}</div>` : ''}
          `;
          
          // Load user avatar
          fetch(`/get_user_avatar/${username}`)
            .then(r => r.json())
            .then(data => {
              const avatar = storyItem.querySelector('.header-story-avatar');
              if (data.avatar && data.avatar !== '/static/default-avatar.png') {
                avatar.src = data.avatar + '?t=' + Date.now();
              }
            })
            .catch(() => {});

          storyItem.onclick = () => showUserStories(username, userStories);
          headerStories.appendChild(storyItem);
        });
      }
    }
  }

  function showUserStories(username, stories) {
    const storyViewer = document.createElement('div');
    storyViewer.className = 'story-viewer';
    
    let currentIndex = 0;
    
    function showStory(index) {
      const story = stories[index];
      if (!story) return;
      
      let content = '';
      if (story.media_url) {
        if (story.media_type === 'video') {
          content = `<video src="${story.media_url}" controls class="story-content" autoplay></video>`;
        } else {
          content = `<img src="${story.media_url}" alt="Story" class="story-content">`;
        }
      } else {
        content = `<div class="story-content story-text">${story.text}</div>`;
      }
      
      storyViewer.innerHTML = `
        ${content}
        <div class="story-controls">
          <button onclick="previousStory()">${index > 0 ? '◀' : ''}</button>
          <button onclick="nextStory()">${index < stories.length - 1 ? '▶' : ''}</button>
          <button onclick="closeStoryViewer()">✕</button>
        </div>
      `;
      
      // Mark as viewed
      fetch('/view_story', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({user: username, story_id: story.id})
      });
    }
    
    window.previousStory = () => {
      if (currentIndex > 0) {
        currentIndex--;
        showStory(currentIndex);
      }
    };
    
    window.nextStory = () => {
      if (currentIndex < stories.length - 1) {
        currentIndex++;
        showStory(currentIndex);
      }
    };
    
    window.closeStoryViewer = () => {
      storyViewer.remove();
    };
    
    document.body.appendChild(storyViewer);
    showStory(currentIndex);
  }

  // Media viewer for fullscreen viewing
  function showMediaViewer(src, type) {
    const mediaViewer = document.createElement('div');
    mediaViewer.className = 'media-viewer show';
    
    let content = '';
    if (type === 'video' || src.includes('.mp4') || src.includes('.mov') || src.includes('.avi') || src.includes('.webm')) {
      content = `<video src="${src}" controls class="media-content" autoplay></video>`;
    } else {
      content = `<img src="${src}" alt="Media" class="media-content">`;
    }
    
    mediaViewer.innerHTML = `
      ${content}
      <div class="media-controls">
        <button onclick="downloadMedia('${src}')">💾</button>
        <button onclick="closeMediaViewer()">✕</button>
      </div>
    `;
    
    document.body.appendChild(mediaViewer);
    
    window.closeMediaViewer = () => {
      mediaViewer.remove();
    };
    
    window.downloadMedia = (url) => {
      const a = document.createElement('a');
      a.href = url;
      a.download = url.split('/').pop();
      a.click();
    };
    
    // Close on click outside
    mediaViewer.onclick = (e) => {
      if (e.target === mediaViewer) {
        closeMediaViewer();
      }
    };
  }

  function addMessage(nick, text, isOwnMessage = false, isSystemMessage = false, index = -1, messageData = null) {
    const div = document.createElement('div');
    div.className = `message ${isOwnMessage ? 'own' : ''} ${isSystemMessage ? 'system' : ''}`;

    if (isSystemMessage) {
      div.innerHTML = `<span class="system-text">${text}</span>`;
    } else {
      // Get user avatar
      let avatarHtml = '';
      if (!isOwnMessage) {
        avatarHtml = `<img src="/static/default-avatar.svg" alt="${nick}" class="message-avatar" onclick="showUserProfile('${nick}')" onerror="this.src='/static/default-avatar.svg'">`;
        // Load actual avatar
        fetch(`/get_user_avatar/${nick}`)
          .then(r => r.json())
          .then(data => {
            const avatar = div.querySelector('.message-avatar');
            if (avatar && data.avatar && data.avatar !== '/static/default-avatar.png') {
              avatar.src = data.avatar + '?t=' + Date.now();
            }
          })
          .catch(() => {
            const avatar = div.querySelector('.message-avatar');
            if (avatar) {
              avatar.src = '/static/default-avatar.svg';
            }
          });
      }

      // Check if message is a file URL or forwarded message
      let messageContent = text;

      // Handle forwarded messages
      if (text.startsWith('📤 Forwarded from ')) {
        const forwardedMatch = text.match(/📤 Forwarded from (.+?):\s*(.*)/s);
        if (forwardedMatch) {
          const originalSender = forwardedMatch[1];
          const originalMessage = forwardedMatch[2].trim();

          // Check if forwarded content is media
          let forwardedContent = originalMessage;
          if (originalMessage.startsWith('/static/uploads/')) {
            const isVideo = originalMessage.includes('.mp4') || originalMessage.includes('.mov') || originalMessage.includes('.avi') || originalMessage.includes('.webm') || originalMessage.includes('.mkv') || originalMessage.includes('.flv') || originalMessage.includes('.wmv');
            if (isVideo) {
              const videoId = `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              forwardedContent = `
                <div class="video-container">
                  <video id="${videoId}" src="${originalMessage}" controls class="shared-video" preload="metadata">
                    Your browser does not support the video tag.
                  </video>
                  <button class="video-reset-btn" onclick="resetVideo('${videoId}')" title="Скинути відео">🔄</button>
                </div>
              `;
            } else {
              forwardedContent = `<img src="${originalMessage}" alt="Forwarded image" class="shared-image" onclick="window.open('${originalMessage}', '_blank')" style="cursor: pointer;">`;
            }
          } else {
            forwardedContent = originalMessage.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
          }

          messageContent = `
            <div class="forwarded-message">
              <div class="forwarded-header">
                <span class="forwarded-icon">📤</span>
                <span>Переслано від <span class="forwarded-from" onclick="showUserProfile('${originalSender}')">${originalSender}</span></span>
              </div>
              <div class="forwarded-content">${forwardedContent}</div>
            </div>
          `;
        }
      } else if (text.startsWith('/static/uploads/')) {
        const isVideo = text.includes('.mp4') || text.includes('.mov') || text.includes('.avi') || text.includes('.webm') || text.includes('.mkv') || text.includes('.flv') || text.includes('.wmv');
        if (isVideo) {
          const videoId = `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          messageContent = `
            <div class="video-container">
              <video id="${videoId}" src="${text}" controls class="shared-video" preload="metadata" onclick="showMediaViewer('${text}', 'video')" style="cursor: pointer; max-width: 100%; height: auto;">
                Your browser does not support the video tag.
              </video>
              <button class="video-reset-btn" onclick="resetVideo('${videoId}')" title="Скинути відео">🔄</button>
            </div>
          `;
        } else {
          messageContent = `<img src="${text}" alt="Shared image" class="shared-image" onclick="showMediaViewer('${text}', 'image')" style="cursor: pointer; margin-top: 4px; max-width: 100%; height: auto;">`;
        }
      } else {
        messageContent = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      }

      // Message status for own messages
      let statusHtml = '';
      if (isOwnMessage) {
        statusHtml = `<span class="message-status" data-status="sent">✓</span>`;
      }

      // Check for verification badge
      let verificationBadge = '';
      fetch(`/get_user_verification/${nick}`)
        .then(r => r.json())
        .then(data => {
          if (data.verified) {
            const authorEl = div.querySelector('.message-author');
            if (authorEl && !authorEl.querySelector('.verification-badge')) {
              authorEl.innerHTML += '<span class="verification-badge">✓</span>';
            }
          }
        })
        .catch(() => {});

      div.innerHTML = `
        <div class="message-wrapper">
          ${avatarHtml}
          <div class="message-content">
            <span class="message-author clickable-username" data-username="${nick}" title="View ${nick}'s profile">${nick}</span>
            <span class="message-text">${messageContent}</span>
            ${statusHtml}
          </div>
        </div>
      `;

      // Add click handler for username and avatar
      const usernameEl = div.querySelector('.message-author');
      const avatarEl = div.querySelector('.message-avatar');

      const showProfile = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (nick !== nickname) {
          showUserProfile(nick);
        }
      };

      if (usernameEl) {
        usernameEl.addEventListener('click', showProfile);
        usernameEl.addEventListener('touchend', showProfile);
      }

      if (avatarEl) {
        avatarEl.addEventListener('click', showProfile);
        avatarEl.addEventListener('touchend', showProfile);
      }

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

  // Show user profile
  function showUserProfile(username) {
    if (username === nickname) return; // Don't show own profile

    // Close any existing modals first
    const existingModals = document.querySelectorAll('.admin-panel');
    existingModals.forEach(modal => modal.remove());

    const modal = document.createElement('div');
    modal.className = 'admin-panel user-profile-modal';
    const isMobile = window.innerWidth <= 768;

    modal.innerHTML = `
      <div class="admin-content user-profile ${isMobile ? 'mobile-profile' : ''}">
        <div class="profile-header">
          <button class="close-profile-btn" onclick="this.closest('.admin-panel').remove()">×</button>
          <img src="/static/default-avatar.svg" alt="${username}" class="profile-avatar" id="profile-avatar">
          <div class="profile-info">
            <h2>${username}</h2>
            <p class="profile-status" id="profile-status">Loading...</p>
          </div>
        </div>
        <div class="profile-details">
          <div class="profile-section">
            <h3>📄 Info</h3>
            <p id="profile-bio">Loading bio...</p>
          </div>
          <div class="profile-section">
            <h3>🕒 Last seen</h3>
            <p id="profile-last-seen">Loading...</p>
          </div>
        </div>
        <div class="profile-actions">
          <button class="profile-action-btn message-btn" onclick="startPrivateChat('${username}')">
            <span class="btn-icon">💬</span>
            <span class="btn-text">Message</span>
          </button>
          <button class="profile-action-btn close-btn" onclick="this.closest('.admin-panel').remove()">
            <span class="btn-icon">✕</span>
            <span class="btn-text">Close</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Load user data
    Promise.all([
      fetch(`/get_user_avatar/${username}`).then(r => r.json()),
      fetch(`/user_status/${username}`).then(r => r.json()),
      fetch(`/get_user_profile/${username}`).then(r => r.json())
    ]).then(([avatarData, statusData, profileData]) => {
      const avatar = document.getElementById('profile-avatar');
      const status = document.getElementById('profile-status');
      const bio = document.getElementById('profile-bio');
      const lastSeen = document.getElementById('profile-last-seen');

      if (avatar) {
        // Виправлено: показувати кастомну аватарку, якщо вона є у users.json
        if (avatarData && avatarData.avatar &&
            avatarData.avatar !== '/static/default-avatar.png' &&
            avatarData.avatar !== '/static/default-avatar.svg') {
          avatar.src = avatarData.avatar + '?t=' + Date.now(); // Force refresh
          avatar.onerror = function() {
            this.src = '/static/default-avatar.svg';
          };
        } else {
          avatar.src = '/static/default-avatar.svg';
        }
      }

      if (status) {
        status.textContent = statusData.status === 'online' ? 'Online' : 'Offline';
        status.className = `profile-status ${statusData.status}`;
      }

      if (bioInput && profileData) {
        // Виправлено: якщо біо є у users.json, показувати його
        bioInput.value = profileData.bio || '';
      }

      if (lastSeen && statusData.last_seen) {
        const lastSeenDate = new Date(statusData.last_seen * 1000);
        const now = new Date();
        const diffHours = (now - lastSeenDate) / (1000 * 60 * 60);
        const diffDays = Math.floor(diffHours / 24);

        if (statusData.status === 'online') {
          lastSeen.textContent = 'Зараз у мережі';
        } else if (diffDays >= 3) {
          lastSeen.textContent = `Був у мережі: ${lastSeenDate.toLocaleDateString('uk-UA')}`;
        } else if (diffDays >= 1) {
          lastSeen.textContent = `Був у мережі: ${diffDays} ${diffDays === 1 ? 'день' : 'дні'} тому`;
        } else {
          lastSeen.textContent = `Був у мережі: ${lastSeenDate.toLocaleTimeString('uk-UA', {hour: '2-digit', minute: '2-digit'})}`;
        }
      }
    });
  }

  // Start private chat from profile
  window.startPrivateChat = function(username) {
    userSearch.value = username;
    createPrivateChat();
    document.querySelector('.admin-panel').remove();
  };

  // Show context menu for messages
  function showMessageContextMenu(e, index, nick, isOwnMessage) {
    hideContextMenu();

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';

    // Get click coordinates
    const clickX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clickY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

    const items = [];

    // Add forward option for all messages
    items.push({text: '↗️ Forward message', action: () => showForwardModal(index, nick)});

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

    // Add mute option for group admins
    if (currentRoom !== 'general' && !currentRoom.startsWith('private_') && !isOwnMessage) {
      checkIfAdmin(currentRoom).then(isAdmin => {
        if (isAdmin || nickname === 'Wixxy') {
          items.push({text: '🔇 Mute user (1h)', action: () => muteUser(nick, 60)});
        }
      });
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

    // Position menu after adding all items
    document.body.appendChild(contextMenu);

    // Get actual menu dimensions
    const rect = contextMenu.getBoundingClientRect();
    const menuWidth = rect.width;
    const menuHeight = rect.height;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    // Calculate optimal position
    let left = clickX;
    let top = clickY;

    // For mobile devices, always position on the left side
    if (window.innerWidth <= 768) {
      left = 20;
      // Ensure menu doesn't go below screen and fits properly
      if (top + menuHeight > windowHeight - 20) {
        top = Math.max(20, windowHeight - menuHeight - 20);
      }
      // Ensure menu doesn't go above screen
      if (top < 20) {
        top = 20;
      }
    } else {
      // Desktop positioning
      if (left + menuWidth > windowWidth - 10) {
        left = Math.max(10, windowWidth - menuWidth - 10);
      }
      if (top + menuHeight > windowHeight - 10) {
        top = Math.max(10, windowHeight - menuHeight - 10);
      }
    }

    // Apply final position
    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';

    // Hide on click outside
    setTimeout(() => {
      document.addEventListener('click', hideContextMenu);
    }, 0);
  }

  // Show forward modal
  function showForwardModal(messageIndex, originalSender) {
    const messages = messageHistory[currentRoom] || [];
    const message = messages[messageIndex];

    if (!message) {
      showNotification('❌ Message not found', 'error');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'admin-panel forward-modal';
    const isMobile = window.innerWidth <= 768;

    modal.innerHTML = `
      <div class="admin-content forward-content">
        <div class="modal-header">
          <h2>📤 Forward Message</h2>
        </div>

        <div class="forward-preview">
          <div class="preview-label">Message to forward:</div>
          <div class="preview-message">
            <span class="preview-sender">${originalSender}</span>
            <div class="preview-text">${message.text.length > 100 ? message.text.substring(0, 100) + '...' : message.text}</div>
          </div>
        </div>

        <div class="forward-search">
          <input type="text" id="forward-search" placeholder="Search rooms..." />
        </div>

        <div class="forward-rooms" id="forward-rooms-list" style="${isMobile ? 'min-height: 250px; max-height: none;' : ''}">
          <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
            Loading rooms...
          </div>
        </div>

        <div class="modal-footer">
          <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Load available rooms
    fetch('/rooms')
      .then(r => r.json())
      .then(rooms => {
        const roomsList = document.getElementById('forward-rooms-list');
        const searchInput = document.getElementById('forward-search');

        function displayRooms(filteredRooms) {
          if (filteredRooms.length === 0) {
            roomsList.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">No rooms found</div>';
            return;
          }

          const isMobile = window.innerWidth<= 768;

          roomsList.innerHTML = filteredRooms.map(room => {
            let displayName, roomType, emoji;

            if (room === 'general') {
              displayName = '# general';
              roomType = 'Public Chat';
              emoji = '🌍';
            } else if (room.startsWith('private_')) {
              const users = room.replace('private_', '').split('_');
              const otherUser = users.find(u => u !== nickname) || users[0];
              displayName = `@ ${otherUser}`;
              roomType = 'Private Chat';
              emoji = '🔐';
            } else {
              displayName = `# ${room}`;
              roomType = 'Group Chat';
              emoji = '👥';
            }

            return `
              <div class="forward-room-item" data-room="${room}">
                <div class="forward-room-info">
                  <div class="forward-room-name">${emoji} ${displayName}</div>
                  <div class="forward-room-type">${roomType}</div>
                </div>
                <button class="forward-btn" onclick="forwardMessageToRoom('${room}', '${messageIndex}', '${originalSender}')">
                  Forward
                </button>
              </div>
            `;
          }).join('');
        }

        displayRooms(rooms.filter(room => room !== currentRoom));

        // Search functionality
        if (searchInput) {
          searchInput.oninput = function() {
            const query = this.value.toLowerCase();
            const filteredRooms = rooms.filter(room => {
              if (room === currentRoom) return false;

              if (room === 'general') return 'general'.includes(query);
              if (room.startsWith('private_')) {
                const users = room.replace('private_', '').split('_');
                const otherUser = users.find(u => u !== nickname) || users[0];
                return otherUser.toLowerCase().includes(query);
              }
              return room.toLowerCase().includes(query);
            });
            displayRooms(filteredRooms);
          };
          searchInput.focus();
        }
      })
      .catch(err => {
        console.error('Failed to load rooms:', err);
        document.getElementById('forward-rooms-list').innerHTML = 
          '<div style="text-align: center; padding: 2rem; color: var(--red-disconnected);">Failed to load rooms</div>';
      });
  }

  // Forward message to specific room
  window.forwardMessageToRoom = function(targetRoom, messageIndex, originalSender) {
    const messages = messageHistory[currentRoom] || [];
    const message = messages[messageIndex];

    if (!message) {
      showNotification('❌ Message not found', 'error');
      return;
    }

    fetch('/forward_message', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        target_room: targetRoom,
        message: message.text,
        original_sender: originalSender
      })
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ Message forwarded successfully', 'success');
        document.querySelector('.forward-modal').remove();
      } else {
        showNotification('❌ Failed to forward message: ' + (data.error || 'Unknown error'), 'error');
      }
    })
    .catch(err => {
      console.error('Failed to forward message:', err);
      showNotification('❌ Error forwarding message', 'error');
    });
  };

  // Clear private chat history for current user
  function clearPrivateHistory() {
    if (confirm('Clear chat history for yourself? This cannot be undone.')) {
      fetch('/clear_private_history', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom})
      })      .then(r => r.json())
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

  // Helper function to check if user is admin
  function checkIfAdmin(room) {
    return fetch(`/get_room_info/${room}`)
      .then(r => r.json())
      .then(data => data.success && data.is_admin)
      .catch(() => false);
  }

  // Toggle theme function
  function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon();
  }

  // Show admin panel function
  function showAdminPanel() {
    // Implementation would be added here
    console.log('Show admin panel');
  }

  // Show group members function
  function showGroupMembers() {
    // Implementation would be added here
    console.log('Show group members');
  }

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

      // Send message with room parameter - don't show immediately
      socket.emit('message', {room: currentRoom, nickname, message});
      messageInput.value = '';
      lastMessageTime = now;
    };
  }

  if (newChatBtn) {
    newChatBtn.onclick = createPrivateChat;
  }

  // File upload functionality
  const fileUploadBtn = document.getElementById('file-upload-btn');
  const fileInput = document.getElementById('file-input');

  if (fileUploadBtn && fileInput) {
    fileUploadBtn.onclick = () => {
      fileInput.click();
    };

    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // Check file size (5MB limit)
      if (file.size > 5 * 1024 * 1024) {
        showNotification('❌ File too large (max 5MB)', 'error');
        return;
      }

      // Check file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'video/mp4', 'video/mov', 'video/avi', 'video/webm'];
      if (!allowedTypes.includes(file.type)) {
        showNotification('❌ Invalid file type', 'error');
        return;
      }

      // Create FormData and upload
      const formData = new FormData();
      formData.append('file', file);
      formData.append('room', currentRoom);

      // Show uploading notification
      showNotification('📤 Uploading...', 'info');

      fetch('/upload_file', {
        method: 'POST',
        body: formData
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          showNotification('✅ File uploaded successfully', 'success');
          // The file will be shown in real-time via socket events
        } else {
          showNotification('❌ ' + (data.error || 'Upload failed'), 'error');
        }
      })
      .catch(err => {
        console.error('Upload failed:', err);
        showNotification('❌ Upload failed', 'error');
      })
      .finally(() => {
        // Reset file input
        fileInput.value = '';
      });
    };
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

      // Show room context menu instead of immediate delete
      showRoomContextMenu();
    };
  }

  // Setup mobile chat dropdown
  function setupMobileChatDropdown(room) {
    const mobileChatOptions = document.getElementById('mobile-chat-options');
    const mobileChatDropdown = document.getElementById('mobile-chat-dropdown');
    if (!mobileChatOptions || !mobileChatDropdown) return;
    mobileChatDropdown.innerHTML = '';
    let dropdownHTML = '';
    if (room === 'general') {
      dropdownHTML += `
        <div class="mobile-dropdown-item" onclick="showSettings()">
          <span>⚙️</span> Settings
        </div>
        <div class="mobile-dropdown-item" onclick="toggleTheme()">
          <span>🌙</span> Theme
        </div>
      `;
    } else if (room.startsWith('private_')) {
      // Private chat options
      dropdownHTML += `
        <div class="mobile-dropdown-item" onclick="showUserProfileFromMenu()">
          <span>👤</span> View Profile
        </div>
        <div class="mobile-dropdown-item" onclick="clearPrivateHistory()">
          <span>🧹</span> Clear History
        </div>
        <div class="mobile-dropdown-item" onclick="deleteCurrentRoom()">
          <span>🗑️</span> Delete Chat
        </div>
        <div class="mobile-dropdown-item" onclick="blockCurrentUser()">
          <span>🚫</span> Block User
        </div>
        <div class="mobile-dropdown-item" onclick="unblockCurrentUser()">
          <span>✅</span> Unblock User
        </div>
      `;
    } else {
      // Group chat options
      dropdownHTML += `
        <div class="mobile-dropdown-item" onclick="showGroupMembers()">
          <span>👥</span> View Members
        </div>
        <div class="mobile-dropdown-item" onclick="leaveCurrentGroup()">
          <span>🚪</span> Leave Group
        </div>
      `;
      // Додаткові опції для адміна
      checkIfAdmin(room).then(isAdmin => {
        if (isAdmin || nickname === 'Wixxy') {
          mobileChatDropdown.innerHTML += `
            <div class="mobile-dropdown-item" onclick="showAddUserDialog()">
              <span>➕</span> Add User
            </div>
            <div class="mobile-dropdown-item" onclick="showKickUserDialog()">
              <span>👢</span> Kick User
            </div>
            <div class="mobile-dropdown-item" onclick="deleteCurrentRoom()">
              <span>🗑️</span> Delete Group
            </div>
          `;
        }
      });
    }
    mobileChatDropdown.innerHTML = dropdownHTML;
    mobileChatOptions.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      mobileChatDropdown.classList.toggle('show');
    };
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.chat-controls')) {
        mobileChatDropdown.classList.remove('show');
      }
    });
  }

  // Show room context menu
  function showRoomContextMenu() {
    // Close any existing modals first
    const existingModals = document.querySelectorAll('.admin-panel');
    existingModals.forEach(modal => modal.remove());

    // Close any existing context menus
    hideContextMenu();

    const modal = document.createElement('div');
    modal.className = 'admin-panel';

    if (currentRoom.startsWith('private_')) {
      // Check if user is blocked to show unblock option
      const users = currentRoom.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];

      modal.innerHTML = `
        <div class="admin-content">
          <h2>💬 Private Chat Options</h2>
          <button class="admin-btn" onclick="deleteCurrentRoom()">🗑️ Delete Chat</button>
          <button class="admin-btn" onclick="blockCurrentUser()">🚫 Block User</button>
          <button class="admin-btn" onclick="unblockCurrentUser()">✅ Unblock User</button>
          <button class="admin-btn" onclick="clearPrivateHistory()">🧹 Clear History</button>
          <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Cancel</button>
        </div>
      `;
    } else {
      // Group chat
      checkIfAdmin(currentRoom).then(isAdmin => {
        let adminOptions = '';
        if (isAdmin || nickname === 'Wixxy') {
          adminOptions = `
            <button class="admin-btn" onclick="showAddUserDialog()">➕ Add User</button>
            <button class="admin-btn" onclick="showKickUserDialog()">👢 Kick User</button>
            <button class="admin-btn" onclick="deleteCurrentRoom()">🗑️ Delete Group</button>
          `;
        }

        modal.innerHTML = `
          <div class="admin-content">
            <h2>👥 Group Options</h2>
            <button class="admin-btn" onclick="showGroupMembers()">👥 View Members</button>
            <button class="admin-btn" onclick="leaveCurrentGroup()">🚪 Leave Group</button>
            ${adminOptions}
            <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Cancel</button>
          </div>
        `;
      });
    }

    document.body.appendChild(modal);
  }

  // Group management functions
  window.deleteCurrentRoom = function() {
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
          document.querySelector('.admin-panel').remove();
        } else {
          showNotification('❌ ' + (data.error || 'Failed to delete room'), 'error');
        }
      });
    }
  };

  window.blockCurrentUser = function() {
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
          document.querySelector('.admin-panel').remove();
        } else {
          showNotification('❌ Failed to block user', 'error');
        }
      });
    }
  };

  window.unblockCurrentUser = function() {
    if (confirm('✅ Unblock this user? They will be able to message you again.')) {
      fetch('/unblock_user', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          showNotification('✅ User unblocked successfully', 'success');
          document.querySelector('.admin-panel').remove();
        } else {
          showNotification('❌ Failed to unblock user', 'error');
        }
      });
    }
  };

  window.leaveCurrentGroup = function() {
    if (confirm('🚪 Leave this group? You will no longer receive messages.')) {
      fetch('/leave_group', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          loadRooms();
          setTimeout(() => joinRoom('general'), 100);
          showNotification('✅ Left group successfully', 'success');
          document.querySelector('.admin-panel').remove();
        } else {
          showNotification('❌ ' + (data.error || 'Failed to leave group'), 'error');
        }
      });
    }
  };

  window.showAddUserDialog = function() {
    // Close existing admin panel
    const existingPanel = document.querySelector('.admin-panel');
    if (existingPanel) existingPanel.remove();

    const modal = document.createElement('div');
    modal.className = 'admin-panel';
    modal.innerHTML = `
      <div class="admin-content">
        <h2>➕ Add User to Group</h2>
        <div style="margin-bottom: 1rem;">
          <input type="text" id="add-user-search" placeholder="Search users..." style="width: 100%; padding: 0.75rem; border: 2px solid rgba(0,0,0,0.1); border-radius: 8px; font-size: 1rem;">
        </div>
        <div id="add-user-list" style="max-height: 300px; overflow-y: auto;"></div>
        <div style="margin-top: 1rem;">
          <button class="admin-btn" onclick="addUserByName()">Add by Username</button>
          <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Load users and setup search
    fetch('/users')
      .then(r => r.json())
      .then(users => {
        const addUserList = document.getElementById('add-user-list');
        const searchInput = document.getElementById('add-user-search');

        function displayUsers(userList) {
          addUserList.innerHTML = userList.map(user => `
            <div class="user-item" style="padding: 0.75rem; border-bottom: 1px solid rgba(0,0,0,0.1); cursor: pointer;" onclick="addUserToGroup('${user}')">
              <span>👤 ${user}</span>
              <button class="admin-btn" style="margin: 0; padding: 0.5rem 1rem; font-size: 0.9rem;" onclick="event.stopPropagation(); addUserToGroup('${user}')">Add</button>
            </div>
          `).join('') || '<p style="padding: 1rem; text-align: center; color: #666;">No users found</p>';
        }

        displayUsers(users);

        // Search functionality
        if (searchInput) {
          searchInput.oninput = function() {
            const query = this.value.toLowerCase();
            const filteredUsers = users.filter(user => user.toLowerCase().includes(query));
            displayUsers(filteredUsers);
          };
          searchInput.focus();
        }
      });
  };

  window.addUserByName = function() {
    const searchInput = document.getElementById('add-user-search');
    const username = searchInput ? searchInput.value.trim() : '';
    if (username) {
      addUserToGroup(username);
    }
  };

  window.addUserToGroup = function(username) {
    fetch('/add_to_group', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: currentRoom, username: username})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ User added successfully', 'success');
        document.querySelector('.admin-panel').remove();
      } else {
        showNotification('❌ ' + (data.error || 'Failed to add user'), 'error');
      }
    });
  };

  window.showKickUserDialog = function() {
    fetch(`/get_room_info/${currentRoom}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const members = data.members.filter(m => m !== nickname);
          if (members.length === 0) {
            showNotification('❌ No other members to kick', 'error');
            return;
          }

          const modal = document.createElement('div');
          modal.className = 'admin-panel';
          modal.innerHTML = `
            <div class="admin-content">
              <h2>👢 Kick User</h2>
              ${members.map(member => `
                <button class="admin-btn" onclick="kickUser('${member}')">${member}</button>
              `).join('')}
              <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Cancel</button>
            </div>
          `;
          document.body.appendChild(modal);
        }
      });
  };

  window.kickUser = function(username) {
    if (confirm(`👢 Kick ${username} from the group?`)) {
      fetch('/kick_from_group', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({room: currentRoom, username: username})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          showNotification('✅ User kicked successfully', 'success');
          document.querySelector('.admin-panel').remove();
        } else {
          showNotification('❌ ' + (data.error || 'Failed to kick user'), 'error');
        }
      });
    }
  };

  window.showGroupMembers = function() {
    fetch(`/get_room_info/${currentRoom}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          const modal = document.createElement('div');
          modal.className = 'admin-panel';
          const isMobile = window.innerWidth <= 768;

          modal.innerHTML = `
            <div class="admin-content ${isMobile ? 'mobile-members' : ''}">
              <div class="modal-header">
                <h2>👥 Group Members (${data.members.length})</h2>
              </div>
              <div class="members-list">
                ${data.members.map(member => `
                  <div class="member-item" onclick="showMemberProfile('${member}')">
                    <img src="/static/default-avatar.png" alt="${member}" class="member-avatar" 
                         onerror="this.src='/static/default-avatar.png'" 
                         onload="loadMemberAvatar('${member}', this)">
                    <div class="member-info">
                      <span class="member-name">${member} ${data.admins.includes(member) ? '👑' : ''}</span>
                      <span class="member-status" id="member-status-${member}">Loading...</span>
                    </div>
                    <span class="member-arrow">→</span>
                  </div>
                `).join('')}
              </div>
              <div class="modal-footer">
                <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Close</button>
              </div>
            </div>
          `;
          document.body.appendChild(modal);

          // Load member statuses
          data.members.forEach(member => {
            fetch(`/user_status/${member}`)
              .then(r => r.json())
              .then(statusData => {
                const statusEl = document.getElementById(`member-status-${member}`);
                if (statusEl) {
                  if (statusData.status === 'online') {
                    statusEl.innerHTML = '🟢 У мережі';
                    statusEl.className = 'member-status online';
                  } else {
                    statusEl.innerHTML = '⚪ Офлайн';
                    statusEl.className = 'member-status offline';
                  }
                }
              });
          });
        }
      });
  };

  // Show member profile from group members
  window.showMemberProfile = function(username) {
    if (username === nickname) return;

    // Close members modal first
    const membersModal = document.querySelector('.admin-panel');
    if (membersModal) membersModal.remove();

    // Show user profile
    showUserProfile(username);
  };

  // Load member avatar
  window.loadMemberAvatar = function(username, imgElement) {
    fetch(`/get_user_avatar/${username}`)
      .then(r => r.json())
      .then(data => {
        if (data.avatar && data.avatar !== '/static/default-avatar.png') {
          imgElement.src = data.avatar + '?t=' + Date.now(); // Force refresh
        } else {
          imgElement.src = '/static/default-avatar.svg'; // Use SVG default
        }
      })
      .catch(() => {
        imgElement.src = '/static/default-avatar.svg';
      });
  };

  window.muteUser = function(username, minutes) {
    fetch('/mute_user', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({room: currentRoom, username: username, duration: minutes})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(`✅ ${username} muted for ${minutes} minutes`, 'success');
      } else {
        showNotification('❌ ' + (data.error || 'Failed to mute user'), 'error');
      }
    });
  };

  // Mobile swipe functionality
  let mobileSwipeStartX = 0;
  let mobileSwipeCurrentX = 0;
  let isSwiping = false;

  // Swipe to show sidebar on mobile
  function handleTouchStart(e) {
    if (window.innerWidth > 768) return; // Only on mobile
    mobileSwipeStartX = e.touches[0].clientX;
    isSwiping = false;
  }

  function handleTouchMove(e) {
    if (window.innerWidth > 768) return;
    mobileSwipeCurrentX = e.touches[0].clientX;
    const deltaX = mobileSwipeCurrentX - mobileSwipeStartX;

    if (Math.abs(deltaX) > 10) {
      isSwiping = true;
    }
  }

  function handleTouchEnd(e) {
    if (window.innerWidth > 768 || !isSwiping) return;

    const deltaX = mobileSwipeCurrentX - mobileSwipeStartX;
    const swipeThreshold = 50; // Reduced threshold for easier swiping

    // Swipe right - show sidebar (chat list)
    if (deltaX > swipeThreshold) {
      sidebar.classList.add('open');
    }
    // Swipe left - show profile/members
    else if (deltaX < -swipeThreshold) {
      if (currentRoom.startsWith('private_')) {
        const users = currentRoom.replace('private_', '').split('_');
        const otherUser = users.find(u => u !== nickname) || users[0];
        showUserProfile(otherUser);
      } else if (currentRoom !== 'general') {
        showGroupMembers();
      }
    }

    isSwiping = false;
  }

  // Define missing functions
  function loadChatHistory() {
    // Load chat history - implementation placeholder
    console.log('Loading chat history...');
  }

  function updateConnectionStatus(status) {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
      statusEl.className = `connection-status ${status}`;
      statusEl.textContent = status === 'connected' ? '🟢 Connected' : 
                            status === 'connecting' ? '🟡 Connecting...' : 
                            '🔴 Disconnected';
    }
  }

  // Update user status in private chats
  async function updateUserStatus(username) {
    if (!currentRoom.startsWith('private_')) return;

    try {
      const response = await fetch(`/user_status/${username}`);
      const data = await response.json();
      const statusEl = document.getElementById(`status-${username}`);
      if (statusEl) {
        if (data.status === 'online') {
          statusEl.innerHTML = '🟢 У мережі';
          statusEl.className = 'chat-status online';
        } else if (data.last_seen) {
          const lastSeen = new Date(data.last_seen * 1000);
          const now = new Date();
          const diffHours = (now - lastSeen) / (1000 * 60 * 60);
          const diffDays = Math.floor(diffHours / 24);

          if (statusEl) {
            if (data.status === 'online') {
              statusEl.innerHTML = 'Зараз у мережі';
            } else if (diffDays >= 3) {
              statusEl.innerHTML = `Був у мережі: ${lastSeen.toLocaleDateString('uk-UA')}`;
            } else if (diffDays >= 1) {
              statusEl.innerHTML = `Був у мережі: ${diffDays} ${diffDays === 1 ? 'день' : 'дні'} тому`;
            } else {
              statusEl.innerHTML = `Був у мережі: ${lastSeen.toLocaleTimeString('uk-UA', {hour: '2-digit', minute: '2-digit'})}`;
            }
            statusEl.className = `chat-status ${data.status}`;
          }
        }
      }
    } catch (err) {
      console.error('Failed to get user status:', err);
      statusEl.innerHTML = '⚪ Офлайн';
      statusEl.className = 'chat-status offline';
    }
  }

  // Update room stats for group chats
  async function updateRoomStats(room) {
    if (room === 'general' || room.startsWith('private_')) return;

    try {
      const response = await fetch(`/room_stats/${room}`);
      const data = await response.json();
      const statusEl = document.getElementById(`status-${room}`);
      if (statusEl) {
        statusEl.innerHTML = `👥 ${data.online_count}/${data.total_count} у мережі`;
        statusEl.className = 'chat-status';
      }
    } catch (err) {
      console.error('Failed to get room stats:', err);
      statusEl.innerHTML = '👥 Статус невідомий';
      statusEl.className = 'chat-status';
    }
  }

  // Add touch event listeners to chat area
  if (messagesDiv) {
    messagesDiv.addEventListener('touchstart', handleTouchStart, {passive: true});
    messagesDiv.addEventListener('touchmove', handleTouchMove, {passive: true});
    messagesDiv.addEventListener('touchend', handleTouchEnd, {passive: true});
  }

  // Click handler for room title (both mobile and desktop)
  if (currentRoomEl) {
    currentRoomEl.addEventListener('click', () => {
      if (currentRoom.startsWith('private_')) {
        const users = currentRoom.replace('private_', '').split('_');
        const otherUser = users.find(u => u !== nickname) || users[0];
        showUserProfile(otherUser);
      } else if (currentRoom !== 'general') {
        // Always show group members when clicking on group name
        showGroupMembers();
      }
    });

    // Add visual hint that title is clickable
    currentRoomEl.style.cursor = 'pointer';
    currentRoomEl.title = currentRoom.startsWith('private_') ? 'Click to view profile' : 
                          currentRoom !== 'general' ? 'Click to view members' : '';
  }

  // Socket event handlers
  socket.on('message', (data) => {
    // Parse room and message from data
    const msgRoom = data.room || 'general';
    let msg = data.message || data;

    // Only show message if it's for the current room
    if (msgRoom !== currentRoom) {
      return;
    }

    if (typeof msg !== 'string') {
      return;
    }

    // Parse message
    const colonIndex = msg.indexOf(':');
    if (colonIndex > 0) {
      const nick = msg.substring(0, colonIndex);
      const text = msg.substring(colonIndex + 1).trim();

      // Don't show our own messages again (they're already shown immediately)
      if (nick === nickname) {
        return;
      }

      addMessage(nick, text, false);

      // Update cache immediately
      if (!messageHistory[currentRoom]) messageHistory[currentRoom] = [];
      messageHistory[currentRoom].push({nick, text, timestamp: Math.floor(Date.now() / 1000)});
      localStorage.setItem('messageHistory', JSON.stringify(messageHistory));

      // Update user activity status in real-time
      if (currentRoom.startsWith('private_')) {
        const users = currentRoom.replace('private_', '').split('_');
        const otherUser = users.find(u => u !== nickname) || users[0];
        updateUserStatus(otherUser);
      } else {
        updateRoomStats(currentRoom);
      }

      // Show notification and sound for others' messages
      if (document.hidden) {
        showDesktopNotification(nick, text);
      }
      playNotificationSound();
    }
  });

  // Handle real-time video/file messages
  socket.on('new_message', (data) => {
    if (data.room !== currentRoom) {
      return;
    }

    // Show all messages in real-time
    addMessage(data.nickname, data.message, data.nickname === nickname);

    // Update cache immediately
    if (!messageHistory[currentRoom]) messageHistory[currentRoom] = [];
    messageHistory[currentRoom].push({
      nick: data.nickname, 
      text: data.message, 
      timestamp: data.timestamp,
      type: data.type,
      file_type: data.file_type
    });
    localStorage.setItem('messageHistory', JSON.stringify(messageHistory));

    // Show notification for media files (but not for our own messages)
    if (data.nickname !== nickname && data.message.startsWith('/static/uploads/')) {
      const isVideo = data.file_type === 'video' || data.message.includes('.mp4') || data.message.includes('.mov') || data.message.includes('.avi') || data.message.includes('.webm');
      const mediaType = isVideo ? 'відео' : 'зображення';

      if (document.hidden) {
        showDesktopNotification(data.nickname, `Надіслав ${mediaType}`);
      }
      playNotificationSound();
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

  socket.on('room_update', (data) => {
    if (data.action === 'kicked_from_group' && data.username === nickname) {
      showNotification(`❌ You were kicked from ${data.room} by ${data.by}`, 'error');
      loadRooms();
      if (currentRoom === data.room) {
        setTimeout(() => joinRoom('general'), 100);
      }
    } else if (data.action === 'added_to_group' && data.username === nickname) {
      showNotification(`✅ You were added to ${data.room} by ${data.by}`, 'success');
      loadRooms();
    }
  });

  socket.on('user_muted', (data) => {
    if (data.username === nickname && data.room === currentRoom) {
      showNotification(`🔇 You were muted for ${data.duration} minutes by ${data.by}`, 'warning');
    }
  });

  socket.on('user_activity_update', (data) => {
    // Update user status in real-time when users join/leave
    if (currentRoom.startsWith('private_')) {
      const users = currentRoom.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      if (data.user === otherUser) {
        updateUserStatus(otherUser);
      }
    } else if (data.room === currentRoom || currentRoom === 'general') {
      updateRoomStats(currentRoom);
    }

    // Handle account deletion or logout
    if (data.action === 'account_deleted' || data.action === 'logout') {
      // Reload admin stats if admin panel is open
      const adminStats = document.getElementById('admin-stats');
      if (adminStats && adminStats.style.display !== 'none') {
        loadStats();
      }
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
    try {
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
    } catch (e) {
      // Ignore audio errors
    }
  }

  // Reset video function
  window.resetVideo = function(videoId) {
    const video = document.getElementById(videoId);
    if (video) {
      video.currentTime = 0;
      video.pause();
    }
  };

  // Handle window resize
  window.addEventListener('resize', () => {
    const isNowMobile = window.innerWidth <= 768;

    if (!isNowMobile) {
      sidebar.classList.remove('open');
      // Hide mobile dropdowns
      const mobileDropdown = document.getElementById('mobile-header-dropdown');
      const mobileChatDropdown = document.getElementById('mobile-chat-dropdown');
      if (mobileDropdown) {
        mobileDropdown.classList.remove('show');
      }
      if (mobileChatDropdown) {
        mobileChatDropdown.classList.remove('show');
      }
    }

    // Update mobile chat options visibility
    const mobileChatOptions = document.getElementById('mobile-chat-options');
    if (mobileChatOptions && currentRoom !== 'general') {
      mobileChatOptions.style.display = (useMobileInterface || isNowMobile) ? 'block' : 'none';
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
          <button class="cancel-btn">Cancel</button>
          <button class="ban-btn">Ban User</button>
        </div>
      </div>
    `;

    // Add event listeners after adding to DOM
    document.body.appendChild(modal);

    const cancelBtn = modal.querySelector('.cancel-btn');
    const banBtn = modal.querySelector('.ban-btn');

    cancelBtn.onclick = () => {
      modal.remove();
    };

    banBtn.onclick = () => {
      banUser(username, modal);
    };
  }

  // Ban user
  function banUser(username, modal) {
    const reasonInput = modal.querySelector('#ban-reason');
    const durationSelect = modal.querySelector('#ban-duration');

    if (!reasonInput || !durationSelect) {
      showNotification('❌ Dialog elements not found', 'error');
      return;
    }

    const reason = reasonInput.value.trim();
    const duration = parseInt(durationSelect.value);

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
        modal.remove();
      } else {
        showNotification('❌ ' + (data.error || 'Failed to ban user'), 'error');
      }
    })
    .catch(err => {
      console.error('Failed to ban user:', err);
      showNotification('❌ Error banning user', 'error');
    });
  }

  // Admin panel
  window.toggleAdminPanel = function() {
    if (nickname !== 'Wixxy') {
      showNotification('❌ Access denied', 'error');
      return;
    }

    // Close any existing modals first
    const existingModals = document.querySelectorAll('.admin-panel');
    existingModals.forEach(modal => modal.remove());

    const modal = document.createElement('div');
    modal.className = 'admin-panel';
    modal.innerHTML = `
      <div class="settings-panel">
        <div class="settings-section">
          <h3>🎨 Appearance</h3>
          <p>OrbitMess використовує тільки темну тему для кращого досвіду користувача.</p>
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
            <textarea id="bio-input" placeholder="Your bio..." maxlength="200" style="width: 100%; padding: 0.75rem; margin: 0.5rem 0; border: 2px solid rgba(0,0,0,0.1); border-radius: 8px; resize: vertical; min-height: 60px;"></textarea>
            <button class="admin-btn" onclick="updateBio()">Update Bio</button>
          </div>
        </div>
        <div class="settings-section">
          <h3>📋 Updates & Changelog</h3>
          <div class="profile-section">
            <button class="admin-btn" onclick="showChangelog()">View Changelog</button>
          </div>
        </div>
        ${nickname === 'Wixxy' ? `
        <div class="settings-section">
          <h3>🔧 Admin Panel</h3>
          <div class="profile-section">
            <button class="admin-btn" onclick="this.closest('.admin-panel').remove(); toggleAdminPanel()">🛠️ Open Admin Panel</button>
            <button class="admin-btn" onclick="grantSelfPremium()" style="background: var(--accent-green); color: black;">⭐ Grant Self Premium</button>
          </div>
        </div>
        ` : ''}
        <div class="settings-section">
          <h3>🚨 Account Actions</h3>
          <div class="profile-section">
            <button class="admin-btn" style="background: #e74c3c;" onclick="deleteAccount()">🗑️ Delete Account</button>
            <button class="admin-btn" style="background: #f39c12;" onclick="logout()">🚪 Logout</button>
          </div>
        </div>
      </div>
      <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Close</button>
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
        const area = document.getElementById('admin-content-area');
        if (area) {
          area.innerHTML = `
            <div class="admin-stats-display">
              <h3>📊 Server Statistics</h3>
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
                <div class="online-users-container">
                  ${data.online_list.map(user => `
                    <div class="online-user">
                      <span class="user-name">${user.nickname}</span>
                      <span class="user-room">in ${user.room}</span>
                      <span class="online-indicator">🟢</span>
                    </div>
                  `).join('') || '<p>No users online</p>'}
                </div>
              </div>
            </div>
          `;
        }

        // Also update sidebar stats
        const statsDiv = document.getElementById('admin-stats');
        if (statsDiv) {
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
        `;
        }
      })
      .catch(err => console.error('Failed to load stats:', err));
  };

  // Load all users for banning with search
  window.loadAllUsers = function() {
    fetch('/users')
      .then(r => r.json())
      .then(users => {
        const area = document.getElementById('admin-content-area');
        area.innerHTML = `
          <h3>Select User to Ban:</h3>
          <div style="margin-bottom: 1rem;">
            <input type="text" id="ban-user-search" placeholder="Search users..." style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div id="ban-user-list">
            ${users.map(user => `
              <div class="user-item" data-username="${user.toLowerCase()}">
                <span>${user}</span>
                <button class="ban-btn" data-username="${user}">Ban</button>
              </div>
            `).join('')}
          </div>
        `;

        // Add search functionality
        const searchInput = document.getElementById('ban-user-search');
        if (searchInput) {
          searchInput.oninput = function() {
            const query = this.value.toLowerCase();
            const userItems = document.querySelectorAll('#ban-user-list .user-item');
            userItems.forEach(item => {
              const username = item.dataset.username;
              if (username.includes(query)) {
                item.style.display = '';
              } else {
                item.style.display = 'none';
              }
            });
          };
        }

        // Add click handlers for ban buttons
        const banButtons = document.querySelectorAll('#ban-user-list .ban-btn');
        banButtons.forEach(btn => {
          btn.onclick = () => {
            const username = btn.getAttribute('data-username');
            showBanDialog(username);
          };
        });
      });
  };

  // Load banned users
  window.loadBannedUsers = function() {
    fetch('/admin/banned_users')
      .then(r => r.json())
      .then(data => {
        const area = document.getElementById('admin-content-area');
        if (data.banned && data.banned.length > 0) {
          area.innerHTML = '<h3>Banned Users:</h3>' + 
            data.banned.map(ban => `
              <div class="ban-item">
                <strong>${ban.username}</strong> (${ban.ip})<br>
                Reason: ${ban.reason}<br>
                Until: ${ban.until}<br>
                <button class="unban-btn" onclick="unbanUser('${ban.username}')">Unban</button>
              </div>
            `).join('');
        } else {
          area.innerHTML = '<p>No banned users</p>';
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

  // Grant premium
  window.showGrantPremium = function() {
    fetch('/users')
      .then(r => r.json())
      .then(users => {
        const area = document.getElementById('admin-content-area');
        area.innerHTML = `
          <h3>Grant Premium to User:</h3>
          <div style="margin-bottom: 1rem;">
            <input type="text" id="premium-user-search" placeholder="Search users..." style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div style="margin-bottom: 1rem;">
            <label>Duration:</label>
            <select id="premium-duration" style="width: 100%; padding: 0.5rem; margin-top: 0.5rem;">
              <option value="1">1 Month</option>
              <option value="6">6 Months</option>
              <option value="12">1 Year</option>
              <option value="-1">Permanent</option>
            </select>
          </div>
          <div id="premium-user-list">
            ${users.map(user => `
              <div class="user-item" data-username="${user.toLowerCase()}">
                <span>${user}</span>
                <button class="admin-btn" onclick="grantPremium('${user}')">Grant Premium</button>
              </div>
            `).join('')}
          </div>
        `;

        // Add search functionality
        const searchInput = document.getElementById('premium-user-search');
        if (searchInput) {
          searchInput.oninput = function() {
            const query = this.value.toLowerCase();
            const userItems = document.querySelectorAll('#premium-user-list .user-item');
            userItems.forEach(item => {
              const username = item.dataset.username;
              if (username.includes(query)) {
                item.style.display = '';
              } else {
                item.style.display = 'none';
              }
            });
          };
        }
      });
  };

  window.grantPremium = function(username) {
    const duration = parseInt(document.getElementById('premium-duration').value);
    
    fetch('/admin/grant_premium', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: username, duration: duration})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(`✅ Premium granted to ${username}`, 'success');
      } else {
        showNotification('❌ ' + (data.error || 'Failed to grant premium'), 'error');
      }
    });
  };

  // Grant verification
  window.showGrantVerification = function() {
    fetch('/users')
      .then(r => r.json())
      .then(users => {
        const area = document.getElementById('admin-content-area');
        area.innerHTML = `
          <h3>Grant Verification Badge:</h3>
          <div style="margin-bottom: 1rem;">
            <input type="text" id="verify-user-search" placeholder="Search users..." style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
          </div>
          <div id="verify-user-list">
            ${users.map(user => `
              <div class="user-item" data-username="${user.toLowerCase()}">
                <span>${user}</span>
                <button class="admin-btn" onclick="grantVerification('${user}')">Grant ✓</button>
                <button class="admin-btn" style="background: #e74c3c;" onclick="removeVerification('${user}')">Remove ✓</button>
              </div>
            `).join('')}
          </div>
        `;

        // Add search functionality
        const searchInput = document.getElementById('verify-user-search');
        if (searchInput) {
          searchInput.oninput = function() {
            const query = this.value.toLowerCase();
            const userItems = document.querySelectorAll('#verify-user-list .user-item');
            userItems.forEach(item => {
              const username = item.dataset.username;
              if (username.includes(query)) {
                item.style.display = '';
              } else {
                item.style.display = 'none';
              }
            });
          };
        }
      });
  };

  window.grantVerification = function(username) {
    fetch('/admin/grant_verification', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: username})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(`✅ Verification granted to ${username}`, 'success');
        // Refresh the verification list
        showGrantVerification();
      } else {
        showNotification('❌ ' + (data.error || 'Failed to grant verification'), 'error');
      }
    })
    .catch(err => {
      console.error('Grant verification error:', err);
      showNotification('❌ Error granting verification', 'error');
    });
  };

  // Grant self premium function for admin
  window.grantSelfPremium = function() {
    if (nickname !== 'Wixxy') return;
    
    fetch('/admin/grant_premium', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: nickname, duration: -1}) // Permanent premium
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('⭐ Premium activated!', 'success');
        // Reload page to apply premium features
        setTimeout(() => window.location.reload(), 1500);
      } else {
        showNotification('❌ Failed to grant premium', 'error');
      }
    })
    .catch(err => {
      console.error('Self premium grant error:', err);
      showNotification('❌ Error granting premium', 'error');
    });
  };

  // Show user profile from private chat menu
  window.showUserProfileFromMenu = function() {
    if (currentRoom.startsWith('private_')) {
      const users = currentRoom.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      mobileChatDropdown.classList.remove('show');
      showUserProfile(otherUser);
    }
  };

  window.removeVerification = function(username) {
    fetch('/admin/remove_verification', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: username})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(`✅ Verification removed from ${username}`, 'success');
      } else {
        showNotification('❌ ' + (data.error || 'Failed to remove verification'), 'error');
      }
    });
  };

  // Enhanced mobile device detection
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileDevice = /iphone|ipad|ipod|android|blackberry|mini|windows\sce|palm/i.test(userAgent);
  const isTabletDevice = /ipad|android/i.test(userAgent) && window.innerWidth > 768;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 768;

  // Update the existing useMobileInterface variable instead of redeclaring it
  useMobileInterface = (isMobileDevice && !isTabletDevice) || (isTouchDevice && isSmallScreen);

  // Apply mobile-specific styles and behaviors
  if (useMobileInterface) {
    document.body.classList.add('mobile-device');
    console.log('Mobile interface activated');

    // Mobile-specific optimizations
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }

    // Optimize touch interactions
    document.addEventListener('touchstart', function() {}, {passive: true});
    document.addEventListener('touchmove', function() {}, {passive: true});
  } else {
    console.log('Desktop interface activated');
  }

  // Settings panel
  window.showSettings = function() {
    // Close any existing modals first
    const existingModals = document.querySelectorAll('.admin-panel');
    existingModals.forEach(modal => modal.remove());

    const modal = document.createElement('div');
    modal.className = 'admin-panel';

    // Detect if user is on a mobile device
    const mobileClass = useMobileInterface ? 'mobile-settings' : '';
    if (mobileClass) {
      modal.classList.add(mobileClass);
    }

    modal.innerHTML = `
      <div class="settings-panel">
        <div class="settings-section">
          <h3>🎨 Appearance</h3>
          <p>OrbitMess використовує тільки темну тему для кращого досвіду користувача.</p>
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
            <textarea id="bio-input" placeholder="Your bio..." maxlength="200" style="width: 100%; padding: 0.75rem; margin: 0.5rem 0; border: 2px solid rgba(0,0,0,0.1); border-radius: 8px; resize: vertical; min-height: 60px;"></textarea>
            <button class="admin-btn" onclick="updateBio()">Update Bio</button>
          </div>
        </div>
        <div class="settings-section">
          <h3>📋 Updates & Changelog</h3>
          <div class="profile-section">
            <button class="admin-btn" onclick="showChangelog()">View Changelog</button>
          </div>
        </div>
        ${nickname === 'Wixxy' ? `
        <div class="settings-section">
          <h3>🔧 Admin Panel</h3>
          <div class="profile-section">
            <button class="admin-btn" onclick="this.closest('.admin-panel').remove(); toggleAdminPanel()">🛠️ Open Admin Panel</button>
            <button class="admin-btn" onclick="grantSelfPremium()" style="background: var(--accent-green); color: black;">⭐ Grant Self Premium</button>
          </div>
        </div>
        ` : ''}
        <div class="settings-section">
          <h3>🚨 Account Actions</h3>
          <div class="profile-section">
            <button class="admin-btn" style="background: #e74c3c;" onclick="deleteAccount()">🗑️ Delete Account</button>
            <button class="admin-btn" style="background: #f39c12;" onclick="logout()">🚪 Logout</button>
          </div>
        </div>
      </div>
      <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Close</button>
    `;
    document.body.appendChild(modal);

    // Setup avatar upload functionality
    setupAvatarUpload();

    // Load current user data and check premium
    Promise.all([
      fetch(`/get_user_avatar/${nickname}`).then(r => r.json()).catch(() => ({avatar: '/static/default-avatar.svg'})),
      fetch(`/get_user_profile/${nickname}`).then(r => r.json()).catch(() => ({bio: ''})),
      fetch('/check_premium').then(r => r.json()).catch(() => ({premium: false})),
      fetch('/get_ui_settings').then(r => r.json()).catch(() => ({}))
    ]).then(([avatarData, profileData, premiumData, uiSettings]) => {
      const avatar = document.getElementById('settings-avatar');
      const bioInput = document.getElementById('bio-input');

      if (avatar) {
        console.log('Avatar data received:', avatarData); // Debug log
        // Check if we have a valid avatar
        if (avatarData && avatarData.avatar && 
            avatarData.avatar !== '/static/default-avatar.png' && 
            avatarData.avatar !== '/static/default-avatar.svg' &&
            !avatarData.avatar.includes('default-avatar')) {
          
          console.log('Loading custom avatar:', avatarData.avatar);
          avatar.src = avatarData.avatar + '?t=' + Date.now(); // Force refresh
          avatar.onerror = function() {
            console.log('Avatar failed to load, using default');
            this.src = '/static/default-avatar.svg';
          };
        } else {
          console.log('Using default avatar');
          avatar.src = '/static/default-avatar.svg';
        }
      }

      if (bioInput && profileData) {
        bioInput.value = profileData.bio || '';
        console.log('Bio loaded:', profileData.bio);
      }

      // Setup avatar upload after elements are loaded
      setupAvatarUpload();

      // Show premium sections if user has premium
      if (premiumData.premium) {
        const premiumUISection = document.getElementById('premium-ui-section');
        const premiumStoriesSection = document.getElementById('premium-stories-section');
        
        if (premiumUISection) {
          premiumUISection.style.display = 'block';
          
          // Load saved UI settings
          if (uiSettings.primary_color) document.getElementById('primary-color').value = uiSettings.primary_color;
          if (uiSettings.accent_color) document.getElementById('accent-color').value = uiSettings.accent_color;
          if (uiSettings.background_blur) document.getElementById('bg-blur').value = uiSettings.background_blur;
          if (uiSettings.transparency) document.getElementById('transparency').value = uiSettings.transparency;
        }
        
        if (premiumStoriesSection) {
          premiumStoriesSection.style.display = 'block';
        }
      }
    }).catch(err => {
      console.error('Failed to load profile data:', err);
    });

  }

  // Premium UI functions
  window.saveUISettings = function() {
    const uiSettings = {
      primary_color: document.getElementById('primary-color').value,
      accent_color: document.getElementById('accent-color').value,
      background_blur: document.getElementById('bg-blur').value,
      transparency: document.getElementById('transparency').value
    };

    fetch('/update_ui_settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ui_settings: uiSettings})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ UI settings saved', 'success');
        applyUISettings(uiSettings);
      } else {
        showNotification('❌ ' + (data.error || 'Failed to save UI settings'), 'error');
      }
    });
  };

  window.resetUISettings = function() {
    const defaultSettings = {
      primary_color: '#9cff2e',
      accent_color: '#7dd824',
      background_blur: '0',
      transparency: '0'
    };

    fetch('/update_ui_settings', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ui_settings: defaultSettings})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ UI reset to default', 'success');
        applyUISettings(defaultSettings);
        
        // Update form
        document.getElementById('primary-color').value = defaultSettings.primary_color;
        document.getElementById('accent-color').value = defaultSettings.accent_color;
        document.getElementById('bg-blur').value = defaultSettings.background_blur;
        document.getElementById('transparency').value = defaultSettings.transparency;
      }
    });
  };

  function applyUISettings(settings) {
    const root = document.documentElement;
    if (settings.primary_color) {
      root.style.setProperty('--accent-green', settings.primary_color);
    }
    if (settings.accent_color) {
      root.style.setProperty('--accent-green-dark', settings.accent_color);
    }
    if (settings.background_blur) {
      root.style.setProperty('--bg-blur', `blur(${settings.background_blur}px)`);
    }
    if (settings.transparency) {
      root.style.setProperty('--bg-opacity', (100 - settings.transparency) / 100);
    }
  }

  // Upload story
  window.uploadStory = function() {
    const mediaFile = document.getElementById('story-media').files[0];
    const storyText = document.getElementById('story-text').value.trim();

    if (!mediaFile && !storyText) {
      showNotification('❌ Please add media or text', 'error');
      return;
    }

    const formData = new FormData();
    if (mediaFile) {
      formData.append('file', mediaFile);
    }
    formData.append('text', storyText);

    showNotification('📤 Uploading story...', 'info');

    fetch('/upload_story', {
      method: 'POST',
      body: formData
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ Story uploaded successfully', 'success');
        document.getElementById('story-media').value = '';
        document.getElementById('story-text').value = '';
        loadStories(); // Reload stories
      } else {
        showNotification('❌ ' + (data.error || 'Failed to upload story'), 'error');
      }
    })
    .catch(err => {
      console.error('Story upload error:', err);
      showNotification('❌ Upload error', 'error');
    });
  };

  // Only dark theme supported - no theme switching

  // Delete account
  window.deleteAccount = function() {
    if (confirm('⚠️ Are you sure you want to delete your account? This action cannot be undone!')) {
      if (confirm('🚨 This will permanently delete all your data. Type your nickname to confirm:')) {
        const confirmNick = prompt('Enter your nickname to confirm deletion:');
        if (confirmNick === nickname) {
          fetch('/delete_account', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'}
          })
          .then(r => r.json())
          .then(data => {
            showNotification('✅ Account deleted successfully', 'success');
            // Clear all local data
            localStorage.clear();
            sessionStorage.clear();
            // Prevent back navigation
            window.history.pushState(null, null, '/');
            window.addEventListener('popstate', function() {
              window.location.replace('/');
            });
            setTimeout(() => {
              window.location.replace('/');
            }, 2000);
          })
          .catch(err => {
            console.error('Failed to delete account:', err);
            // Clear local data even on error
            localStorage.clear();
            sessionStorage.clear();
            showNotification('❌ Error deleting account', 'error');
            setTimeout(() => {
              window.location.replace('/');
            }, 1000);
          });
        } else {
          showNotification('❌ Nickname confirmation failed', 'error');
        }
      }
    }
  };

  // Logout
  window.logout = function() {
    if (confirm('🚪 Are you sure you want to logout?')) {
      fetch('/logout', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'}
      })
      .then(r => r.json())
      .then(data => {
        showNotification('✅ Logged out successfully', 'success');
        // Clear all local data
        localStorage.clear();
        sessionStorage.clear();
        // Prevent back navigation
        window.history.pushState(null, null, '/');
        window.addEventListener('popstate', function() {
          window.location.href = '/';
        });
        setTimeout(() => {
          window.location.replace('/');
        }, 1000);
      })
      .catch(err => {
        console.error('Logout failed:', err);
        // Clear all local data even on error
        localStorage.clear();
        sessionStorage.clear();
        window.location.replace('/');
      });
    }
  };

  // Change nickname
  window.changeNickname = function() {
    const newNick = document.getElementById('new-nickname').value.trim();

    if (!newNick) {
      showNotification('❌ Please enter a new nickname', 'error');
      return;
    }

    if (newNick === nickname) {
      showNotification('❌ This is already your nickname', 'error');
      return;
    }

    if (newNick.length < 2 || newNick.length > 20) {
      showNotification('❌ Nickname must be 2-20 characters', 'error');
      return;
    }

    fetch('/change_nickname', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({new_nickname: newNick})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ Nickname changed! Please refresh to apply changes.', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        showNotification('❌ ' + (data.error || 'Failed to change nickname'), 'error');
      }
    })
    .catch(err => {
      console.error('Failed to change nickname:', err);
      showNotification('❌ Error changing nickname', 'error');
    });
  };

  // Update bio
  window.updateBio = function() {
    const bio = document.getElementById('bio-input').value.trim();

    fetch('/update_profile', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({bio: bio})
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ Bio updated successfully', 'success');
      } else {
        showNotification('❌ ' + (data.error || 'Failed to update bio'), 'error');
      }
    })
    .catch(err => {
      console.error('Failed to update bio:', err);
      showNotification('❌ Error updating bio', 'error');
    });
  };

  // Show changelog - РЕДАГУЙТЕ ТУТ ДЛЯ ЗМІНИ CHANGELOG
  window.showChangelog = function() {
    const modal = document.createElement('div');
    modal.className = 'admin-panel';
    modal.innerHTML = `
      <div class="admin-content changelog-content">
        <div class="modal-header">
          <h2>📋 OrbitMess Changelog</h2>
        </div>
        <div class="changelog-scroll">
          <div class="changelog-item">
            <div class="changelog-date">Version 2.0 - 14.07.25</div>
            <div class="changelog-title">Premium Features & Major Update</div>
            <ul class="changelog-changes">
              <li class="added">Premium підписка з оплатою</li>
              <li class="added">Історії для premium користувачів</li>
              <li class="added">Кастомізація UI для premium</li>
              <li class="added">Галочки верифікації</li>
              <li class="added">Мобільний сайдбар замість налаштувань</li>
              <li class="added">Повноекранний перегляд медіа</li>
              <li class="added">Конфіденційність і зміна пароля</li>
              <li class="improved">Покращений дизайн інтерфейсу</li>
            </ul>
          </div>
          <div class="changelog-item">
            <div class="changelog-date">Version 1.4 - 12.07.25</div>
            <div class="changelog-title">Mobile & UX Improvements</div>
            <ul class="changelog-changes">
              <li class="added">Мобільна оптимізація для телефонів</li>
              <li class="added">Перегляд учасників групи при натисканні на назву</li>
              <li class="added">Профілі користувачів при натисканні на нікнейм</li>
              <li class="improved">Зменшена кнопка "Надіслати"</li>
              <li class="fixed">Виправлені помилки з JavaScript</li>
            </ul>
          </div>

        </div>
        <div class="modal-footer">
          <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  };

  // Show premium purchase modal
  window.showPremiumPurchase = function() {
    const modal = document.createElement('div');
    modal.className = 'premium-modal';
    modal.innerHTML = `
      <div class="premium-content">
        <div style="text-align: center; margin-bottom: 2rem;">
          <h2 style="color: var(--accent-green); margin-bottom: 0.5rem;">⭐ OrbitMess Premium</h2>
          <p style="color: var(--text-secondary);">Отримайте доступ до ексклюзивних функцій</p>
        </div>
        
        <div class="premium-plans">
          <div class="premium-plan" data-duration="1">
            <div class="plan-title">1 Місяць</div>
            <div class="plan-price">199₴</div>
            <div class="plan-description">• Кастомізація UI<br>• Історії<br>• Прем-функції</div>
          </div>
          
          <div class="premium-plan" data-duration="6">
            <div class="plan-title">6 Місяців</div>
            <div class="plan-price">999₴</div>
            <div class="plan-description">• Знижка 17%<br>• Всі прем-функції<br>• Пріоритетна підтримка</div>
          </div>
          
          <div class="premium-plan" data-duration="12">
            <div class="plan-title">1 Рік</div>
            <div class="plan-price">1799₴</div>
            <div class="plan-description">• Знижка 25%<br>• Найкраща ціна<br>• VIP статус</div>
          </div>
        </div>
        
        <div class="payment-info" style="margin: 2rem 0; padding: 1rem; background: var(--surface-lighter); border-radius: 8px;">
          <h3 style="color: var(--accent-green); margin-bottom: 1rem;">💳 Безпечна оплата</h3>
          <p style="margin-bottom: 0.5rem;"><strong>Метод:</strong> Visa/MasterCard через захищений шлюз</p>
          <p style="margin-bottom: 0.5rem;"><strong>Безпека:</strong> 256-bit SSL шифрування</p>
          <p style="color: var(--text-secondary); font-size: 0.9rem;">Ваші платіжні дані повністю захищені</p>
        </div>
        
        <div style="display: flex; gap: 1rem; justify-content: center;">
          <button class="admin-btn" onclick="purchasePremium()" id="purchase-btn" disabled>Отримати реквізити</button>
          <button class="admin-btn close-btn" onclick="this.closest('.premium-modal').remove()">Скасувати</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add plan selection
    const plans = modal.querySelectorAll('.premium-plan');
    const purchaseBtn = modal.querySelector('#purchase-btn');
    let selectedDuration = null;
    let selectedPrice = null;
    
    plans.forEach(plan => {
      plan.onclick = () => {
        plans.forEach(p => p.classList.remove('selected'));
        plan.classList.add('selected');
        selectedDuration = parseInt(plan.dataset.duration);
        selectedPrice = plan.querySelector('.plan-price').textContent;
        purchaseBtn.disabled = false;
      };
    });
    
    window.purchasePremium = function() {
      if (!selectedDuration) return;
      
      // Process payment through Visa
      fetch('/purchase_premium_visa', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({duration: selectedDuration})
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          // Show Visa payment processing modal
          const paymentModal = document.createElement('div');
          paymentModal.className = 'premium-modal';
          paymentModal.innerHTML = `
            <div class="premium-content">
              <div style="text-align: center; margin-bottom: 2rem;">
                <h2 style="color: var(--accent-green);">💳 Обробка платежу Visa</h2>
              </div>
              
              <div class="payment-details" style="background: var(--surface-lighter); padding: 2rem; border-radius: 12px; margin: 2rem 0;">
                <div style="display: flex; align-items: center; margin-bottom: 1rem;">
                  <span style="font-size: 2rem; margin-right: 1rem;">💰</span>
                  <div>
                    <h3 style="margin: 0; color: var(--accent-green);">Сума: ${selectedPrice}</h3>
                    <p style="margin: 0; color: var(--text-secondary);">Тариф: ${selectedDuration === 1 ? '1 Місяць' : selectedDuration === 6 ? '6 Місяців' : '1 Рік'}</p>
                  </div>
                </div>
                
                <div style="margin-bottom: 1.5rem;">
                  <h4 style="color: var(--accent-green); margin-bottom: 0.5rem;">🔐 ID Транзакції:</h4>
                  <div style="background: var(--surface-dark); padding: 1rem; border-radius: 8px; font-family: monospace; font-size: 1rem; color: var(--accent-green); text-align: center;">
                    ${data.payment_details.transaction_id}
                  </div>
                </div>
                
                <div style="background: var(--surface-accent); padding: 1rem; border-radius: 8px; border-left: 4px solid var(--accent-green);">
                  <h4 style="color: var(--accent-green); margin-top: 0;">📝 Для завершення оплати:</h4>
                  <ol style="margin: 0; color: var(--text-secondary);">
                    <li>Зверніться до адміна @Wixxy в чаті</li>
                    <li>Вкажіть ID транзакції: <strong>${data.payment_details.transaction_id}</strong></li>
                    <li>Адмін надасть безпечне посилання для оплати через Visa</li>
                    <li>Преміум буде активовано автоматично після оплати</li>
                  </ol>
                </div>
              </div>
              
              <div style="display: flex; gap: 1rem; justify-content: center;">
                <button class="admin-btn" onclick="this.closest('.premium-modal').remove()">Зрозуміло</button>
              </div>
            </div>
          `;
          
          // Replace current modal with payment processing
          modal.replaceWith(paymentModal);
        } else {
          showNotification('❌ Помилка обробки платежу', 'error');
        }
      })
      .catch(err => {
        console.error('Payment error:', err);
        showNotification('❌ Помилка підключення до платіжної системи', 'error');
      });
    };
  };

  // Show privacy settings
  window.showPrivacySettings = function() {
    const modal = document.createElement('div');
    modal.className = 'admin-panel';
    modal.innerHTML = `
      <div class="admin-content">
        <div class="modal-header">
          <h2>🔒 Конфіденційність</h2>
        </div>
        
        <div class="privacy-section">
          <h3>Зміна пароля</h3>
          <p style="color: var(--text-secondary); margin-bottom: 1rem; font-size: 0.9rem; font-style: italic;">
            ⚠️ Якщо не пам'ятаєте поточний пароль, то зверністеся до адміна.
          </p>
          <div class="password-change">
            <input type="password" id="current-password" placeholder="Поточний пароль">
            <input type="password" id="new-password" placeholder="Новий пароль">
            <input type="password" id="confirm-password" placeholder="Підтвердити пароль">
            <button class="admin-btn" onclick="changePassword()">Змінити пароль</button>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="admin-btn close-btn" onclick="this.closest('.admin-panel').remove()">Закрити</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    window.changePassword = function() {
      const currentPassword = document.getElementById('current-password').value;
      const newPassword = document.getElementById('new-password').value;
      const confirmPassword = document.getElementById('confirm-password').value;
      
      if (!currentPassword || !newPassword || !confirmPassword) {
        showNotification('❌ Заповніть всі поля', 'error');
        return;
      }
      
      if (newPassword !== confirmPassword) {
        showNotification('❌ Паролі не співпадають', 'error');
        return;
      }
      
      if (newPassword.length < 6) {
        showNotification('❌ Пароль повинен містити мінімум 6 символів', 'error');
        return;
      }
      
      fetch('/change_password', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          showNotification('✅ Пароль успішно змінено', 'success');
          modal.remove();
        } else {
          showNotification('❌ ' + (data.error || 'Помилка зміни пароля'), 'error');
        }
      })
      .catch(err => {
        console.error('Password change error:', err);
        showNotification('❌ Помилка підключення', 'error');
      });
    };
  };

  // Avatar upload functionality - setup on settings panel open
  function setupAvatarUpload() {
    const avatarInput = document.getElementById('avatar-input');
    if (avatarInput && !avatarInput.hasAttribute('data-setup')) {
      avatarInput.setAttribute('data-setup', 'true');
      avatarInput.onchange = function(e) {
        const file = e.target.files[0];
        if (file) {
          uploadAvatar(file);
          e.target.value = '';
        }
      };
    }
  }

  function uploadAvatar(file) {
    if (file.size > 2 * 1024 * 1024) {
      showNotification('❌ Avatar too large (max 2MB)', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    showNotification('📤 Uploading avatar...', 'info');

    fetch('/upload_avatar', {
      method: 'POST',
      body: formData
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ Avatar updated successfully', 'success');
        const settingsAvatar = document.getElementById('settings-avatar');
        if (settingsAvatar) {
          settingsAvatar.src = data.avatar_url + '?t=' + Date.now();
          settingsAvatar.onerror = function() {
            this.src = '/static/default-avatar.svg';
          };
        }
        
        // Also update header avatar
        const headerAvatar = document.getElementById('header-avatar');
        if (headerAvatar) {
          headerAvatar.src = data.avatar_url + '?t=' + Date.now();
          headerAvatar.onerror = function() {
            this.src = '/static/default-avatar.svg';
          };
        }
      } else {
        showNotification('❌ ' + (data.error || 'Avatar upload failed'), 'error');        }
    })
    .catch(err => {
      console.error('Avatar upload failed:', err);
      showNotification('❌ Avatar upload error', 'error');
    });
  }

  // Upload file
  function uploadFile(file) {
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      showNotification('❌ File too large (max 5MB)', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('room', currentRoom);

    showNotification('📤 Uploading...', 'info');

    fetch('/upload_file', {
      method: 'POST',
      body: formData
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification('✅ File uploaded successfully', 'success');
        // File URL will be sent as message automatically
      } else {
        showNotification('❌ ' + (data.error || 'Upload failed'), 'error');
      }
    })
    .catch(err => {
      console.error('Upload failed:', err);
      showNotification('❌ Upload error', 'error');
    });
  }

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
        } else if (data.last_seen) {
          const lastSeen = new Date(data.last_seen * 1000);
          const now = new Date();
          const diffHours = (now - lastSeen) / (1000 * 60 * 60);
          const diffDays = Math.floor(diffHours / 24);

          let lastSeenText;
          if (diffDays >= 3) {
            lastSeenText = `був ${lastSeen.toLocaleDateString('uk-UA')}`;
          } else if (diffDays >= 1) {
            lastSeenText = `був ${diffDays} ${diffDays === 1 ? 'день' : 'дні'} тому`;
          } else if (diffHours >= 1) {
            lastSeenText = `був ${Math.floor(diffHours)} ${Math.floor(diffHours) === 1 ? 'годину' : 'годин'} тому`;
          } else {
            lastSeenText = `був ${lastSeen.toLocaleTimeString('uk-UA', {hour: '2-digit', minute: '2-digit'})}`;
          }

          statusDiv.innerHTML = `<span class="status-indicator offline">⚪</span> ${lastSeenText}`;
        } else {
          statusDiv.innerHTML = '<span class="status-indicator offline">⚪</span> був давно';
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

    // Update chat list statuses in real-time
    updateChatListStatus();
  });

  // Listen for real-time user activity updates
  socket.on('user_activity_update', (data) => {
    if (data.user && data.user !== nickname) {
      // Update online users tracking
      if (data.action === 'joined' || data.action === 'online') {
        onlineUsers.add(data.user);
      } else if (data.action === 'left' || data.action === 'offline' || data.action === 'logout' || data.action === 'account_deleted') {
        onlineUsers.delete(data.user);
      }

      // Update chat list immediately
      updateChatListStatus();

      // Update current room status if relevant
      if (currentRoom.startsWith('private_')) {
        const users = currentRoom.replace('private_', '').split('_');
        const otherUser = users.find(u => u !== nickname) || users[0];
        if (data.user === otherUser) {
          updateUserStatus(otherUser);
        }
      } else {
        updateRoomStats(currentRoom);
      }
    }
  });

  // Listen for avatar updates
  socket.on('avatar_updated', (data) => {
    if (data.user && data.avatar_url) {
      // Update all avatars for this user in messages
      document.querySelectorAll(`.message-avatar[alt="${data.user}"]`).forEach(img => {
        img.src = data.avatar_url + '?t=' + Date.now();
      });

      // Update avatar in user info if it's current user
      if (data.user === nickname) {
        const userAvatar = document.querySelector('.user-info-avatar');
        if (userAvatar) {
          userAvatar.src = data.avatar_url + '?t=' + Date.now();
        }
      }

      // Update avatar in settings if open
      const settingsAvatar = document.getElementById('settings-avatar');
      if (settingsAvatar && data.user === nickname) {
        settingsAvatar.src = data.avatar_url + '?t=' + Date.now();
      }

      // Update avatar in member lists
      document.querySelectorAll(`img[alt="${data.user}"]`).forEach(img => {
        if (img.classList.contains('member-avatar') || img.classList.contains('profile-avatar')) {
          img.src = data.avatar_url + '?t=' + Date.now();
        }
      });
    }
  });

  // Listen for profile updates
  socket.on('profile_updated', (data) => {
    if (data.user && data.bio !== undefined) {
      // Update bio in open profile modals
      const profileBio = document.getElementById('profile-bio');
      if (profileBio && data.user !== nickname) {
        profileBio.textContent = data.bio || 'No bio available';
      }
    }
  });

  // Listen for online users list updates
  socket.on('online_users_update', (data) => {
    onlineUsers = new Set(data.users || []);
    updateChatListStatus();
    updateUsersList();
  });

  // Real-time updates every 10 seconds for better responsiveness
  setInterval(() => {
    if (currentRoom.startsWith('private_')) {
      const users = currentRoom.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      updateUserStatus(otherUser);
    } else {
      updateRoomStats(currentRoom);
    }

    // Update chat list statuses
    updateChatListStatus();
  }, 10000);

  // Even more frequent updates for online status (every 5 seconds)
  setInterval(() => {
    updateChatListStatus();
  }, 5000);

  // Real-time admin stats updates
  if (nickname === 'Wixxy') {
    setInterval(() => {
      const statsDiv = document.getElementById('admin-stats');
      if (statsDiv && statsDiv.style.display !== 'none') {
        loadStats();
      }
    }, 10000); // Update every 10 seconds for admin
  }

  // Clear history button for mobile
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  if (clearHistoryBtn) {
    clearHistoryBtn.onclick = () => {
      if (currentRoom.startsWith('private_')) {
        clearPrivateHistory();
      }
    };
  }

  // File upload functionality handled elsewhere in the code

  // Upload file function
  function uploadFile(file) {
    // Check file type
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');

    if (!isVideo && !isImage) {
      showNotification('❌ Only images and videos are allowed', 'error');
      return;
    }

    // Unified size limit for all files
    const maxSize = 50 * 1024 * 1024; // 50MB for all files

    if (file.size > maxSize) {
      showNotification(`❌ File too large (max 50MB)`, 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('room', currentRoom);

    const fileType = isVideo ? 'video' : 'image';
    showNotification(`📤 Uploading ${fileType}...`, 'info');

    fetch('/upload_file', {
      method: 'POST',
      body: formData
    })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        showNotification(`✅ ${fileType.charAt(0).toUpperCase() + fileType.slice(1)} uploaded successfully`, 'success');
        // The file will appear in real-time via socket events
      } else {
        showNotification('❌ ' + (data.error || 'Upload failed'), 'error');
      }
    })
    .catch(err => {
      console.error('Upload failed:', err);
      showNotification('❌ Upload error', 'error');
    });
  }

  // Handle nickname changes
  socket.on('nickname_changed', (data) => {
    // Update chat display names in real-time
    const oldNick = data.old_nickname;
    const newNick = data.new_nickname;

    // Update room list display names
    document.querySelectorAll('.chat-item').forEach(item => {
      const room = item.getAttribute('data-room');
      if (room && room.startsWith('private_')) {
        const users = room.replace('private_', '').split('_');
        const otherUser = users.find(u => u !== nickname) || users[0];
        if (otherUser === oldNick) {
          const chatName = item.querySelector('.chat-name');
          if (chatName) {
            chatName.textContent = `@ ${newNick}`;
          }
        }
      }
    });

    // Update current room header if needed
    if (currentRoom.startsWith('private_')) {
      const users = currentRoom.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      if (otherUser === oldNick && currentRoomEl) {
        currentRoomEl.textContent = `@ ${newNick}`;
      }
    }

    // Update message display names
    document.querySelectorAll('.message-author').forEach(author => {
      if (author.textContent === oldNick) {
        author.textContent = newNick;
      }
    });

    // Reload rooms and messages to ensure consistency
    loadRooms();
    loadMessages(currentRoom);
  });

  // Initial setup
  loadRooms();
  setTimeout(() => joinRoom('general'), 100);

  // Load stories and premium features
  loadStories();
  checkPremium().then(premiumData => {
    if (premiumData.premium) {
      // Load and apply custom UI settings
      fetch('/get_ui_settings')
        .then(r => r.json())
        .then(settings => {
          if (Object.keys(settings).length > 0) {
            applyUISettings(settings);
          }
        });
    }
  });

  // Auto-refresh room list and stories every 2 minutes
  setInterval(() => {
    loadRooms();
    loadStories();
  }, 120000);

  // Load header avatar
  const headerAvatar = document.getElementById('header-avatar');
  if (headerAvatar) {
    fetch(`/get_user_avatar/${nickname}`)
      .then(r => r.json())
      .then(data => {
        if (data.avatar && data.avatar !== '/static/default-avatar.png') {
          headerAvatar.src = data.avatar + '?t=' + Date.now();
        } else {
          headerAvatar.src = '/static/default-avatar.svg';
        }
      })
      .catch(err => {
        console.error('Failed to load user avatar:', err);
        headerAvatar.src = '/static/default-avatar.svg';
      });
  }

  // Setup mobile chat dropdown
  function setupMobileChatDropdown(room) {
    const mobileChatOptions = document.getElementById('mobile-chat-options');
    const mobileChatDropdown = document.getElementById('mobile-chat-dropdown');
    const mobileHome = document.getElementById('mobile-home');
    const mobileViewProfile = document.getElementById('mobile-view-profile');
    const mobileClearHistory = document.getElementById('mobile-clear-history');
    const mobileDeleteChat = document.getElementById('mobile-delete-chat');
    const mobileBlockUser = document.getElementById('mobile-block-user');
    const mobileUnblockUser = document.getElementById('mobile-unblock-user');

    if (!mobileChatOptions || !mobileChatDropdown) {
      console.error('Mobile chat dropdown elements not found');
      return;
    }

    // Always show home button for non-general chats
    if (mobileHome) {
      mobileHome.style.display = room !== 'general' ? 'flex' : 'none';
      mobileHome.onclick = () => {
        mobileChatDropdown.classList.remove('show');
        sidebar.classList.add('open');
      };
    }

    // Show/hide options based on room type
    if (room.startsWith('private_')) {
      const users = room.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];

      if (mobileViewProfile) {
        mobileViewProfile.style.display = 'flex';
        mobileViewProfile.onclick = () => {
          mobileChatDropdown.classList.remove('show');
          showUserProfile(otherUser);
        };
      }

      if (mobileClearHistory) {
        mobileClearHistory.style.display = 'flex';
        mobileClearHistory.innerHTML = '<span>🗑️</span> Clear History';
        mobileClearHistory.onclick = () => {
          mobileChatDropdown.classList.remove('show');
          clearPrivateHistory();
        };
      }

      if (mobileDeleteChat) {
        mobileDeleteChat.style.display = 'flex';
        mobileDeleteChat.innerHTML = '<span>❌</span> Delete Chat';
        mobileDeleteChat.onclick = () => {
          mobileChatDropdown.classList.remove('show');
          deleteCurrentRoom();
        };
      }

      if (mobileBlockUser) {
        mobileBlockUser.style.display = 'flex';
        mobileBlockUser.onclick = () => {
          mobileChatDropdown.classList.remove('show');
          blockCurrentUser();
        };
      }

      if (mobileUnblockUser) {
        mobileUnblockUser.style.display = 'flex';
        mobileUnblockUser.onclick = () => {
          mobileChatDropdown.classList.remove('show');
          unblockCurrentUser();
        };
      }
    } else if (room === 'general') {
      // General chat - only show settings
      if (mobileViewProfile) mobileViewProfile.style.display = 'none';
      if (mobileBlockUser) mobileBlockUser.style.display = 'none';
      if (mobileUnblockUser) mobileUnblockUser.style.display = 'none';
      if (mobileClearHistory) mobileClearHistory.style.display = 'none';
      if (mobileDeleteChat) mobileDeleteChat.style.display = 'none';
      if (mobileHome) mobileHome.style.display = 'none';
    } else {
      // Group chat
      if (mobileViewProfile) {
        mobileViewProfile.style.display = 'flex';
        mobileViewProfile.innerHTML = '<span>👥</span> View Members';
        mobileViewProfile.onclick = () => {
          mobileChatDropdown.classList.remove('show');
          showGroupMembers();
        };
      }
      if (mobileBlockUser) mobileBlockUser.style.display = 'none';
      if (mobileUnblockUser) mobileUnblockUser.style.display = 'none';
      if (mobileClearHistory) mobileClearHistory.style.display = 'none';

      if (mobileDeleteChat) {
        mobileDeleteChat.style.display = 'flex';
        mobileDeleteChat.innerHTML = '<span>🚪</span> Leave Group';
        mobileDeleteChat.onclick = () => {
          mobileChatDropdown.classList.remove('show');
          leaveCurrentGroup();
        };
      }

      // Check if user is admin for additional options
      checkIfAdmin(room).then(isAdmin => {
        if (isAdmin || nickname === 'Wixxy') {
          // Add admin options to dropdown
          if (!document.getElementById('mobile-admin-options')) {
            const adminOptions = document.createElement('div');
            adminOptions.id = 'mobile-admin-options';
            adminOptions.innerHTML = `
              <div class="mobile-dropdown-item" onclick="showAddUserDialog(); document.getElementById('mobile-chat-dropdown').classList.remove('show');">
                <span>➕</span>
                Add User
              </div>
              <div class="mobile-dropdown-item" onclick="showKickUserDialog(); document.getElementById('mobile-chat-dropdown').classList.remove('show');">
                <span>👢</span>
                Kick User
              </div>
              <div class="mobile-dropdown-item" onclick="deleteCurrentRoom(); document.getElementById('mobile-chat-dropdown').classList.remove('show');">
                <span>🗑️</span>
                Delete Group
              </div>
            `;
            mobileChatDropdown.appendChild(adminOptions);
          }
        }
      });
    }

    // Toggle dropdown
    mobileChatOptions.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Mobile chat options clicked');
      mobileChatDropdown.classList.toggle('show');
    };

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.chat-controls')) {
        mobileChatDropdown.classList.remove('show');
      }
    });

    // Ensure the mobile options button is working
    mobileChatOptions.style.pointerEvents = 'auto';
    mobileChatOptions.style.cursor = 'pointer';
  }

  // Setup header buttons
  const settingsBtn = document.getElementById('settings-btn');
  const adminBtn = document.getElementById('admin-btn');

  if (settingsBtn) {
    settingsBtn.onclick = window.showSettings;
  }

  // Hide admin button since it's now in settings
  if (adminBtn) {
    adminBtn.style.display = 'none';
  }

  // Add create group button
  if (createGroupBtn) {
    createGroupBtn.onclick = () => {
      const groupPanel = document.getElementById('group-panel');
      const groupNameInput = document.getElementById('group-name-input');

      if (groupPanel) {
        groupPanel.style.display = groupPanel.style.display === 'none' ? 'block' : 'none';
        if (groupPanel.style.display === 'block') {
          groupNameInput.focus();
        }
      }
    };
  }

  // Group creation panel handlers with null checks
  const createGroupConfirm = document.getElementById('create-group-confirm');
  const createGroupCancel = document.getElementById('create-group-cancel');
  const groupNameInput = document.getElementById('group-name-input');
  const groupPanel = document.getElementById('group-panel');

  if (createGroupConfirm && groupNameInput && groupPanel) {
    createGroupConfirm.onclick = () => {
      const groupName = groupNameInput.value.trim();
      if (groupName) {
        fetch('/create_group', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name: groupName})
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            loadRooms();
            setTimeout(() => joinRoom(data.room), 100);
            showNotification('✅ Group created successfully', 'success');
            groupNameInput.value = '';
            groupPanel.style.display = 'none';
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

  if (createGroupCancel && groupNameInput && groupPanel){
    createGroupCancel.onclick = () => {
      groupNameInput.value = '';
      groupPanel.style.display = 'none';
    };
  }

  if (groupNameInput && createGroupConfirm) {
    groupNameInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        createGroupConfirm.click();
      }
    };
  }

  //// Auto-refresh functionality - reduced frequency to prevent server overload
  let refreshInterval;

  function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
      if (currentRoom) {
        // Only refresh if we haven't received any socket messages recently
        if (currentRoom.startsWith('private_')) {
          const users = currentRoom.replace('private_', '').split('_');
          const otherUser = users.find(u => u !== nickname) || users[0];
          updateUserStatus(otherUser);
        } else {
          updateRoomStats(currentRoom);
        }
      }
    }, 30000); // Reduced to 30 seconds
  }

  // Start auto-refresh on load
  startAutoRefresh();

  // Status update function for private chats
  function updateUserStatusPeriodically() {
    if (currentRoom && currentRoom.startsWith('private_')) {
      const users = currentRoom.replace('private_', '').split('_');
      const otherUser = users.find(u => u !== nickname) || users[0];
      if (otherUser) {
        updateUserStatus(otherUser);
      }
    }
  }

  // Update user status every 60 seconds
  setInterval(updateUserStatusPeriodically, 60000);

  let onlineUsers = new Set();

  function updateChatListStatus() {
    document.querySelectorAll('.chat-item').forEach(item => {
      const room = item.getAttribute('data-room');
      const chatStatus = item.querySelector('.chat-status');
      if (chatStatus && room) {
        if (room.startsWith('private_')) {
          const users = room.replace('private_', '').split('_');
          const otherUser = users.find(u => u !== nickname) || users[0];

          // Real-time status update
          fetch(`/user_status/${otherUser}`)
            .then(r => r.json())
            .then(data => {
              if (data.status === 'online') {
                chatStatus.innerHTML = '🟢 У мережі';
                chatStatus.className = 'chat-status online';
              } else if (data.last_seen) {
                const lastSeen = new Date(data.last_seen * 1000);
                const now = new Date();
                const diffHours = (now - lastSeen) / (1000 * 60 * 60);
                const diffDays = Math.floor(diffHours / 24);

                if (diffDays >= 3) {
                  chatStatus.innerHTML = `⚪ Був ${lastSeen.toLocaleDateString('uk-UA')}`;
                } else if (diffDays >= 1) {
                  chatStatus.innerHTML = `⚪ Був ${diffDays} ${diffDays === 1 ? 'день' : 'дні'} тому`;
                } else {
                  chatStatus.innerHTML = `⚪ Був ${lastSeen.toLocaleTimeString('uk-UA', {hour: '2-digit', minute: '2-digit'})}`;
                }
                chatStatus.className = 'chat-status offline';
              } else {
                chatStatus.innerHTML = '⚪ Був давно';
                chatStatus.className = 'chat-status offline';
              }
            })
            .catch(() => {
              chatStatus.innerHTML = '⚪ Офлайн';
              chatStatus.className = 'chat-status offline';
            });
        } else if (room !== 'general') {
          // Update group chat stats in real-time
          fetch(`/room_stats/${room}`)
            .then(r => r.json())
            .then(data => {
              chatStatus.innerHTML = `👥 ${data.online_count}/${data.total_count} у мережі`;
              chatStatus.className = 'chat-status';
            })
            .catch(() => {
              chatStatus.innerHTML = '👥 Статус невідомий';
              chatStatus.className = 'chat-status';
            });
        }
      }
    });
  }

  function updateUsersList() {
    // Update users list - placeholder for future implementation
  }

  function loadChatList() {
    // Load chat list - placeholder for future implementation  
  }

  socket.on('connect', function() {
    console.log('Connected to server');
    updateConnectionStatus('connected');
    socket.emit('join_room', { room: currentRoom });
  });

  socket.on('disconnect', function() {
    console.log('Disconnected from server');
    updateConnectionStatus('disconnected');
  });

  socket.on('connect_error', function() {
    updateConnectionStatus('disconnected');
  });

  socket.on('reconnect', function() {
    updateConnectionStatus('connected');
  });

  socket.on('reconnect_attempt', function() {
    updateConnectionStatus('connecting');
  });

  socket.on('user_joined', function(data) {
    appendMessage('system', '', `${data.nickname} joined the chat`);
    onlineUsers.add(data.nickname);
    updateUsersList();
    updateChatListStatus();
  });

  socket.on('user_left', function(data) {
    appendMessage('system', '', `${data.nickname} left the chat`);
    onlineUsers.delete(data.nickname);
    updateUsersList();
    updateChatListStatus();
  });

  socket.on('online_users', function(data) {
    onlineUsers = new Set(data.users);
    updateChatListStatus();
  });

  // Video reset function
  window.resetVideo = function(videoId) {
    const video = document.getElementById(videoId);
    if (video) {
      video.currentTime = 0;
      video.pause();
      video.load(); // Reload video to reset completely
      showNotification('✅ Відео скинуто', 'success');
    }
  };

  // Initialize - removed undefined function calls

  // Request online users list
  setTimeout(() => {
    socket.emit('get_online_users');
  }, 1000);

  // Mobile header swipe for settings
  if (window.innerWidth <= 768) {
    const chatHeaderEl = document.querySelector('.chat-header');
    if (chatHeaderEl) {
      let headerSwipeStartX = 0;
      let headerSwipeStartY = 0;

      chatHeaderEl.addEventListener('touchstart', (e) => {
        headerSwipeStartX = e.touches[0].clientX;
        headerSwipeStartY = e.touches[0].clientY;
      });

      chatHeaderEl.addEventListener('touchend', (e) => {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = headerSwipeStartX - endX;
        const diffY = Math.abs(headerSwipeStartY - endY);

        // Swipe left to show settings
        if (diffX > 50 && diffY < 100) {
          window.showSettings();
        }
      });
    }
  }
});