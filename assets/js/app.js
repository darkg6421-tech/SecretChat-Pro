/* ================================================
   SecretChat Pro — Firebase Chat Logic
   ================================================ */

(() => {
  'use strict';

  // ---- Firebase Config (PLACEHOLDER — replace with your own) ----
  const firebaseConfig = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT.firebaseapp.com",
    databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId:         "YOUR_PROJECT",
    storageBucket:     "YOUR_PROJECT.appspot.com",
    messagingSenderId: "000000000000",
    appId:             "1:000000000000:web:0000000000000000000000"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.database();

  // ---- DOM Refs ----
  const $ = (sel) => document.querySelector(sel);
  const joinScreen       = $('#joinScreen');
  const chatScreen       = $('#chatScreen');
  const joinForm         = $('#joinForm');
  const usernameInput    = $('#usernameInput');
  const roomInput        = $('#roomInput');
  const joinBtn          = $('#joinBtn');
  const roomNameDisplay  = $('#roomNameDisplay');
  const partnerStatus    = $('#partnerStatus');
  const partnerAvatarEl  = $('#partnerAvatarHeader');
  const waitingOverlay   = $('#waitingOverlay');
  const roomCodeText     = $('#roomCodeText');
  const copyRoomCode     = $('#copyRoomCode');
  const messagesArea     = $('#messagesArea');
  const messagesList     = $('#messagesList');
  const messageInput     = $('#messageInput');
  const sendBtn          = $('#sendBtn');
  const leaveBtn         = $('#leaveBtn');
  const typingIndicator  = $('#typingIndicator');
  const typingInitials   = $('#typingAvatarInitials');
  const toastContainer   = $('#toastContainer');

  // ---- State ----
  let currentUser   = '';
  let currentRoom   = '';
  let roomRef       = null;
  let messagesRef   = null;
  let presenceRef   = null;
  let typingRef     = null;
  let partnerName   = '';
  let typingTimeout = null;
  let lastSender    = '';
  let lastDateStr   = '';
  let unsubscribers = [];

  // ---- Utilities ----
  function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 86400000 && d.getDate() === now.getDate()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      messagesArea.scrollTo({
        top: messagesArea.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant'
      });
    });
  }

  // ---- Toast ----
  function showToast(message, type = 'info') {
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>',
      error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
      info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3500);
  }

  // ---- Auto-resize textarea ----
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    sendBtn.disabled = !messageInput.value.trim();
    broadcastTyping();
  });

  // ---- Join Room ----
  joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = usernameInput.value.trim();
    const room = roomInput.value.trim();
    if (!name || !room) return;

    currentUser = name;
    currentRoom = room;
    joinRoom();
  });

  function joinRoom() {
    // Show loading
    joinBtn.querySelector('.btn-text').hidden = true;
    joinBtn.querySelector('.btn-arrow').hidden = true;
    joinBtn.querySelector('.btn-loader').hidden = false;
    joinBtn.disabled = true;

    roomRef     = db.ref(`rooms/${currentRoom}`);
    messagesRef = db.ref(`rooms/${currentRoom}/messages`);
    presenceRef = db.ref(`rooms/${currentRoom}/presence`);
    typingRef   = db.ref(`rooms/${currentRoom}/typing`);

    // Check room capacity
    presenceRef.once('value').then((snap) => {
      const data = snap.val() || {};
      const users = Object.keys(data);

      if (users.length >= 2 && !users.includes(currentUser)) {
        showToast('Room is full. Only 2 users allowed.', 'error');
        resetJoinBtn();
        return;
      }

      // Register presence
      const myPresenceRef = presenceRef.child(currentUser);
      myPresenceRef.set(true);
      myPresenceRef.onDisconnect().remove();

      switchToChat();
      listenPresence();
      listenMessages();
      listenTyping();
    }).catch((err) => {
      console.error(err);
      showToast('Failed to connect. Check Firebase config.', 'error');
      resetJoinBtn();
    });
  }

  function resetJoinBtn() {
    joinBtn.querySelector('.btn-text').hidden = false;
    joinBtn.querySelector('.btn-arrow').hidden = false;
    joinBtn.querySelector('.btn-loader').hidden = true;
    joinBtn.disabled = false;
  }

  function switchToChat() {
    joinScreen.classList.remove('active');
    chatScreen.classList.add('active');
    roomNameDisplay.textContent = currentRoom;
    roomCodeText.textContent = currentRoom;
    messageInput.disabled = false;
    messageInput.focus();
  }

  // ---- Presence ----
  function listenPresence() {
    const handler = presenceRef.on('value', (snap) => {
      const data = snap.val() || {};
      const users = Object.keys(data);
      const partner = users.find(u => u !== currentUser);

      if (partner) {
        partnerName = partner;
        setPartnerOnline(partner);
        waitingOverlay.classList.add('hidden');
        messageInput.disabled = false;
        sendBtn.disabled = !messageInput.value.trim();
      } else {
        partnerName = '';
        setPartnerWaiting();
        waitingOverlay.classList.remove('hidden');
      }
    });
    unsubscribers.push(() => presenceRef.off('value', handler));
  }

  function setPartnerOnline(name) {
    const dot = partnerStatus.querySelector('.status-dot');
    const text = partnerStatus.querySelector('.status-text');
    dot.className = 'status-dot online';
    text.textContent = `${name} is online`;
    partnerAvatarEl.hidden = false;
    partnerAvatarEl.querySelector('.avatar-initials').textContent = getInitials(name);
    typingInitials.textContent = getInitials(name);
  }

  function setPartnerWaiting() {
    const dot = partnerStatus.querySelector('.status-dot');
    const text = partnerStatus.querySelector('.status-text');
    dot.className = 'status-dot waiting';
    text.textContent = 'Waiting for partner…';
    partnerAvatarEl.hidden = true;
  }

  function setPartnerOffline(name) {
    const dot = partnerStatus.querySelector('.status-dot');
    const text = partnerStatus.querySelector('.status-text');
    dot.className = 'status-dot offline';
    text.textContent = name ? `${name} went offline` : 'Partner disconnected';
  }

  // ---- Messages ----
  function listenMessages() {
    lastSender = '';
    lastDateStr = '';

    const handler = messagesRef.on('child_added', (snap) => {
      const msg = snap.val();
      if (!msg) return;
      renderMessage(msg);
      scrollToBottom();
    });
    unsubscribers.push(() => messagesRef.off('child_added', handler));
  }

  function renderMessage(msg) {
    const isSent = msg.sender === currentUser;
    const dateStr = formatDate(msg.timestamp);

    // Date separator
    if (dateStr !== lastDateStr) {
      lastDateStr = dateStr;
      const sep = document.createElement('div');
      sep.className = 'date-separator';
      sep.innerHTML = `<span>${dateStr}</span>`;
      messagesList.appendChild(sep);
      lastSender = '';
    }

    // System messages
    if (msg.type === 'system') {
      const sys = document.createElement('div');
      sys.className = 'system-message';
      sys.innerHTML = `<span>${escapeHtml(msg.text)}</span>`;
      messagesList.appendChild(sys);
      lastSender = '';
      return;
    }

    const consecutive = msg.sender === lastSender;
    lastSender = msg.sender;

    const row = document.createElement('div');
    row.className = `message-row ${isSent ? 'sent' : 'received'}${consecutive ? ' consecutive' : ''}`;

    const avatarClass = isSent ? 'sent-avatar' : 'received-avatar';
    const initials = getInitials(msg.sender);

    row.innerHTML = `
      <div class="msg-avatar ${avatarClass}">
        <span class="avatar-initials">${initials}</span>
      </div>
      <div class="msg-bubble">
        <div class="msg-text">${escapeHtml(msg.text)}</div>
        <div class="msg-meta">
          <span class="msg-time">${formatTime(msg.timestamp)}</span>
        </div>
      </div>
    `;

    messagesList.appendChild(row);
  }

  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const msg = {
      sender: currentUser,
      text: text,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      type: 'text'
    };

    messagesRef.push(msg);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;

    // Clear typing indicator
    if (typingRef) {
      typingRef.child(currentUser).remove();
    }
  }

  sendBtn.addEventListener('click', sendMessage);

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ---- Typing Indicator ----
  function broadcastTyping() {
    if (!typingRef || !currentUser) return;
    const text = messageInput.value.trim();

    if (text) {
      typingRef.child(currentUser).set(true);
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        typingRef.child(currentUser).remove();
      }, 3000);
    } else {
      typingRef.child(currentUser).remove();
      clearTimeout(typingTimeout);
    }
  }

  function listenTyping() {
    const handler = typingRef.on('value', (snap) => {
      const data = snap.val() || {};
      const typingUsers = Object.keys(data).filter(u => u !== currentUser);

      if (typingUsers.length > 0) {
        typingIndicator.hidden = false;
        scrollToBottom();
      } else {
        typingIndicator.hidden = true;
      }
    });
    unsubscribers.push(() => typingRef.off('value', handler));
  }

  // ---- Copy Room Code ----
  copyRoomCode.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoom).then(() => {
      showToast('Room code copied!', 'success');
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = currentRoom;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Room code copied!', 'success');
    });
  });

  // ---- Leave Room ----
  leaveBtn.addEventListener('click', leaveRoom);

  function leaveRoom() {
    // Cleanup Firebase listeners
    unsubscribers.forEach(fn => fn());
    unsubscribers = [];

    // Remove presence
    if (presenceRef && currentUser) {
      presenceRef.child(currentUser).remove();
    }

    // Remove typing
    if (typingRef && currentUser) {
      typingRef.child(currentUser).remove();
    }

    // Clear state
    currentUser = '';
    currentRoom = '';
    partnerName = '';
    lastSender  = '';
    lastDateStr = '';
    roomRef = null;
    messagesRef = null;
    presenceRef = null;
    typingRef = null;

    // Clear UI
    messagesList.innerHTML = '';
    messageInput.value = '';
    messageInput.style.height = 'auto';
    messageInput.disabled = true;
    sendBtn.disabled = true;
    waitingOverlay.classList.remove('hidden');
    partnerAvatarEl.hidden = true;

    // Reset join form
    resetJoinBtn();

    // Switch screens
    chatScreen.classList.remove('active');
    joinScreen.classList.add('active');
  }

  // ---- Handle page unload ----
  window.addEventListener('beforeunload', () => {
    if (presenceRef && currentUser) {
      presenceRef.child(currentUser).remove();
    }
    if (typingRef && currentUser) {
      typingRef.child(currentUser).remove();
    }
  });

})();