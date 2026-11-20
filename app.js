(() => {
  const $ = id => document.getElementById(id);
  const playerKey = 'rps_arena_anonymous_player_v1';
  const playerId = getOrCreatePlayerId();
  const choiceFa = { rock: 'سنگ', paper: 'کاغذ', scissors: 'قیچی' };
  let ws = null;
  let currentRoom = null;
  let myChoice = null;
  let toastTimer = null;

  function getOrCreatePlayerId() {
    let id = localStorage.getItem(playerKey);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `p_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
      localStorage.setItem(playerKey, id);
    }
    return id;
  }

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 3200);
  }

  function setConnection(message, connected = false) {
    $('connectionText').textContent = message;
    const dot = document.querySelector('.live-dot');
    if (dot) dot.style.background = connected ? '#35df9b' : '#ffb45b';
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch { /* non-JSON response */ }
    if (!response.ok) throw new Error(data.error || `خطای سرور (${response.status})`);
    return data;
  }

  function showLobby() {
    $('lobbySection').classList.remove('hidden');
    $('lobbySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateRoom(room) {
    if (!room) return;
    currentRoom = room;
    $('lobbySection').classList.add('hidden');
    $('matchSection').classList.remove('hidden');
    $('roomCodeLabel').textContent = room.code;

    const mine = room.players?.find(player => player.id === playerId);
    const opponent = room.players?.find(player => player.id !== playerId);
    $('playerOneName').textContent = 'Player 1 (شما)';
    $('playerOneStatus').textContent = mine?.connected ? '● متصل' : 'در انتظار اتصال';
    $('playerTwoName').textContent = 'Player 2';
    $('playerTwoStatus').textContent = opponent ? (opponent.connected ? '● متصل' : 'اتصال قطع شده') : 'منتظر ورود حریف';
    $('roundLabel').textContent = room.status === 'playing' ? `دور ${room.round}` : room.status === 'finished' ? 'پایان دور' : 'در انتظار حریف';

    if (room.status === 'waiting') {
      $('waitingBox').classList.remove('hidden');
      $('playBox').classList.add('hidden');
    } else {
      $('waitingBox').classList.add('hidden');
      $('playBox').classList.remove('hidden');
    }
  }

  function startClientRound() {
    myChoice = null;
    $('resultBox').classList.add('hidden');
    $('rematchBtn').classList.add('hidden');
    $('playTitle').textContent = 'حرکت خودت را انتخاب کن';
    $('moveHint').textContent = 'هر دو بازیکن باید انتخاب کنند';
    document.querySelectorAll('.move-btn').forEach(button => {
      button.disabled = false;
      button.classList.remove('selected');
    });
  }

  function showResult(result) {
    const didWin = result.winnerId === playerId;
    const isDraw = !result.winnerId;
    const opponentId = Object.keys(result.choices || {}).find(id => id !== playerId);
    const myMove = result.choices?.[playerId];
    const opponentMove = result.choices?.[opponentId];
    const box = $('resultBox');
    box.className = `result-box ${isDraw ? 'draw' : didWin ? 'win' : 'loss'}`;
    box.replaceChildren();

    const title = document.createElement('b');
    title.textContent = isDraw ? '🤝 مساوی شد!' : didWin ? '🏆 Player 1 برنده شدی!' : 'این دور را باختی!';
    const moves = document.createElement('div');
    moves.textContent = `حرکت تو: ${choiceFa[myMove] || '—'} | حرکت حریف: ${choiceFa[opponentMove] || '—'}`;
    box.append(title, moves);
    box.classList.remove('hidden');

    $('playTitle').textContent = isDraw ? 'نتیجه دور: مساوی' : didWin ? 'نتیجه دور: پیروزی تو' : 'نتیجه دور: پیروزی حریف';
    $('moveHint').textContent = 'این مسابقه بدون حساب کاربری و ذخیره رنکینگ انجام می‌شود.';
    document.querySelectorAll('.move-btn').forEach(button => { button.disabled = true; });
    $('rematchBtn').classList.remove('hidden');
    $('rematchBtn').textContent = 'بازی مجدد';
  }

  function send(type, data = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast('اتصال زنده برقرار نیست؛ چند لحظه بعد دوباره تلاش کن.');
      return false;
    }
    ws.send(JSON.stringify({ type, ...data }));
    return true;
  }

  function connectRoom(code) {
    if (ws) { try { ws.close(); } catch { /* ignore */ } }
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${scheme}://${location.host}/api/rooms/${code}/connect?playerId=${encodeURIComponent(playerId)}`);
    ws.addEventListener('open', () => setConnection('متصل به سرور', true));
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'room:update') updateRoom(message.data);
      if (message.type === 'match:started') { updateRoom(message.data); startClientRound(); }
      if (message.type === 'match:result') showResult(message.data);
      if (message.type === 'match:rematch-waiting') toast('درخواست بازی مجدد ثبت شد؛ منتظر حریف بمان.');
      if (message.type === 'room:closed') { toast(message.data.message || 'اتاق بسته شد.'); resetMatchView(); }
      if (message.type === 'error') toast(message.data.message || 'خطای مسابقه');
    });
    ws.addEventListener('close', () => setConnection('اتصال قطع شد', false));
    ws.addEventListener('error', () => setConnection('خطای اتصال', false));
  }

  function resetMatchView() {
    if (ws) { ws.close(); ws = null; }
    currentRoom = null;
    myChoice = null;
    $('matchSection').classList.add('hidden');
    $('lobbySection').classList.remove('hidden');
    $('waitingBox').classList.remove('hidden');
    $('playBox').classList.add('hidden');
    $('resultBox').classList.add('hidden');
    $('roomCodeInput').value = '';
  }

  $('goOnlineBtn').addEventListener('click', showLobby);
  $('createRoomBtn').addEventListener('click', async () => {
    try {
      const data = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ playerId }) });
      updateRoom(data.room);
      connectRoom(data.code);
      toast(`اتاق ${data.code} ساخته شد؛ کد را برای دوستت بفرست.`);
    } catch (error) { toast(error.message); }
  });

  $('joinRoomBtn').addEventListener('click', async () => {
    const code = $('roomCodeInput').value.replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) return toast('کد اتاق باید دقیقاً ۶ رقم باشد.');
    try {
      const data = await api(`/api/rooms/${code}/join`, { method: 'POST', body: JSON.stringify({ playerId }) });
      updateRoom(data.room);
      connectRoom(code);
      toast('با موفقیت به اتاق متصل شدی.');
    } catch (error) { toast(error.message); }
  });

  $('roomCodeInput').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); });
  $('copyCodeBtn').addEventListener('click', async () => {
    const code = currentRoom?.code || $('roomCodeLabel').textContent;
    try { await navigator.clipboard.writeText(code); toast('کد اتاق کپی شد.'); }
    catch { toast(`کد اتاق: ${code}`); }
  });

  document.querySelectorAll('.move-btn').forEach(button => button.addEventListener('click', () => {
    if (myChoice) return;
    myChoice = button.dataset.choice;
    button.classList.add('selected');
    document.querySelectorAll('.move-btn').forEach(item => { item.disabled = true; });
    $('playTitle').textContent = 'حرکت ثبت شد!';
    $('moveHint').textContent = 'منتظر انتخاب حریف هستیم...';
    if (!send('move', { choice: myChoice })) {
      myChoice = null;
      document.querySelectorAll('.move-btn').forEach(item => { item.disabled = false; });
    }
  }));

  $('rematchBtn').addEventListener('click', () => {
    if (send('rematch')) {
      $('rematchBtn').classList.add('hidden');
      toast('درخواست بازی مجدد ثبت شد؛ منتظر حریف بمان.');
    }
  });
  $('leaveRoomBtn').addEventListener('click', () => {
    send('leave');
    resetMatchView();
    toast('از اتاق خارج شدی.');
  });

  async function boot() {
    try {
      const response = await api('/api/health');
      if (response.ok) setConnection('آماده بازی', true);
    } catch { setConnection('سرور در دسترس نیست', false); }
  }

  boot();
})();
