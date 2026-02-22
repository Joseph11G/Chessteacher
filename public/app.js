import { Chess } from '/vendor/chess.js/chess.js';

const socket = io();
const chess = new Chess();

const pieceImageMap = {
  p: { w: '/assets/pieces/white_pawn.png', b: '/assets/pieces/black_pawn.png' },
  r: { w: '/assets/pieces/white_rook.png', b: '/assets/pieces/black_rook.png' },
  n: { w: '/assets/pieces/white_knight.png', b: '/assets/pieces/black_knight.png' },
  b: { w: '/assets/pieces/white_bishop.png', b: '/assets/pieces/black_bishop.png' },
  q: { w: '/assets/pieces/white_queen.png', b: '/assets/pieces/black_queen.png' },
  k: { w: '/assets/pieces/white_king.png', b: '/assets/pieces/black_king.png' },
};

const ADMIN_SESSION_KEY = 'ct-admin-session-token';

let selectedSquare = null;
let legalTargets = [];
let currentRoom = new URLSearchParams(window.location.search).get('room') || null;
let playingBot = null;
let moveQualityLog = [];
let lastAnnouncedMove = null;
let botMoveRequestPending = false;
let isAdmin = false;
let playerName = '';
let roomPlayers = [];

const humanColor = 'w';

const boardEl = document.getElementById('board');
const historyEl = document.getElementById('history');
const roomLinkEl = document.getElementById('roomLink');
const chatLog = document.getElementById('chatLog');
const coach = document.getElementById('coach');
const identityEl = document.getElementById('identityText');
const analyzeBtn = document.getElementById('analyzeBtn');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminLogoutBtn = document.getElementById('adminLogoutBtn');

function getAdminSessionToken() {
  return localStorage.getItem(ADMIN_SESSION_KEY);
}

function setAdminSessionToken(token) {
  localStorage.setItem(ADMIN_SESSION_KEY, token);
}

function clearAdminSessionToken() {
  localStorage.removeItem(ADMIN_SESSION_KEY);
}

function resolveIdentity() {
  const remembered = localStorage.getItem('ct-player-name');
  if (remembered) {
    playerName = remembered;
    return;
  }

  const entered = window.prompt('Enter your name to join this room:', 'Guest');
  playerName = (entered || 'Guest').trim() || 'Guest';
  localStorage.setItem('ct-player-name', playerName);
}

function updateAdminControls() {
  identityEl.textContent = playerName
    ? `Playing as ${playerName}${isAdmin ? ' (Admin)' : ''}`
    : 'Not joined yet';

  analyzeBtn.disabled = !isAdmin;
  saveProfileBtn.disabled = !isAdmin;

  analyzeBtn.title = isAdmin ? '' : 'Only the room admin can use analysis.';
  saveProfileBtn.title = isAdmin ? '' : 'Only the room admin can save profiles.';

  adminLoginBtn.disabled = isAdmin;
  adminLogoutBtn.disabled = !getAdminSessionToken();
}

async function loadBots() {
  try {
    const res = await fetch('/api/bots');
    const data = await res.json();
    const select = document.getElementById('botSelect');
    select.innerHTML = '';

    const bots = [...(data.preset || []), ...(data.dynamic || [])];
    if (!bots.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No bots available';
      select.appendChild(opt);
      return;
    }

    bots.forEach((bot) => {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(bot);
      opt.textContent = `${bot.name} (${bot.rating} ELO)`;
      select.appendChild(opt);
    });
  } catch {
    coach.textContent = 'Could not load bots right now. Check server connection.';
  }
}

function clearChat() {
  chatLog.innerHTML = '';
}

function logChat(message, who = 'Coach') {
  const line = document.createElement('p');
  line.textContent = `${who}: ${message}`;
  chatLog.prepend(line);
}

function renderBoard() {
  boardEl.innerHTML = '';
  const board = chess.board();

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = document.createElement('button');
      square.type = 'button';
      const algebraic = `${String.fromCharCode(97 + file)}${8 - rank}`;
      square.dataset.square = algebraic;
      square.className = `square ${(rank + file) % 2 === 0 ? 'light' : 'dark'}`;

      if (selectedSquare === algebraic) square.classList.add('selected');
      if (legalTargets.includes(algebraic)) square.classList.add('target');

      if (file === 0) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = `${8 - rank}`;
        square.appendChild(rankLabel);
      }

      if (rank === 7) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = String.fromCharCode(97 + file);
        square.appendChild(fileLabel);
      }

      const piece = board[rank][file];
      if (piece) {
        const pieceEl = document.createElement('img');
        pieceEl.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
        pieceEl.src = pieceImageMap[piece.type][piece.color];
        pieceEl.alt = `${piece.color === 'w' ? 'White' : 'Black'} ${piece.type}`;
        pieceEl.draggable = false;
        square.appendChild(pieceEl);
      }

      square.addEventListener('pointerup', () => onSquareClick(algebraic));
      boardEl.appendChild(square);
    }
  }
}

function renderHistory() {
  historyEl.innerHTML = '';
  chess.history().forEach((move, idx) => {
    const li = document.createElement('li');
    li.textContent = `${idx + 1}. ${move}`;
    historyEl.appendChild(li);
  });
}

function selectSquare(square) {
  const piece = chess.get(square);
  if (!piece || piece.color !== chess.turn()) return;

  if (playingBot && piece.color !== humanColor) {
    coach.textContent = 'You control White in bot games. Wait for the bot to move Black.';
    return;
  }

  selectedSquare = square;
  legalTargets = chess.moves({ square, verbose: true }).map((move) => move.to);
  renderBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalTargets = [];
}

function onSquareClick(square) {
  if (playingBot && chess.turn() !== humanColor) {
    coach.textContent = 'Bot is thinking... please wait for its move.';
    return;
  }

  if (!selectedSquare) {
    selectSquare(square);
    return;
  }

  if (selectedSquare === square) {
    clearSelection();
    renderBoard();
    return;
  }

  const move = { from: selectedSquare, to: square, promotion: 'q' };
  clearSelection();

  const played = chess.move(move);
  if (!played) {
    coach.textContent = 'Move not made. Pick one of the highlighted legal squares.';
    selectSquare(square);
    return;
  }

  if (currentRoom) socket.emit('make-move', { roomId: currentRoom, move });
  renderBoard();
  renderHistory();
  if (isAdmin) analyzeMove(played.san);
}

function maybeRequestBotMove() {
  if (!playingBot || !currentRoom || chess.isGameOver()) return;

  const botColor = humanColor === 'w' ? 'b' : 'w';
  if (chess.turn() !== botColor || botMoveRequestPending) return;

  botMoveRequestPending = true;
  setTimeout(() => {
    socket.emit('bot-move', { roomId: currentRoom, bot: playingBot });

    setTimeout(() => {
      if (chess.turn() === botColor && !chess.isGameOver()) {
        botMoveRequestPending = false;
        maybeRequestBotMove();
      }
    }, 1200);
  }, 350);
}

function describeMoveThemes(san) {
  const lowered = san.toLowerCase();
  const notes = [];

  if (/[a-h][45]/.test(lowered) || lowered.includes('e5') || lowered.includes('e4') || lowered.includes('d4')) {
    notes.push('helps fight for the center, giving your pieces more room and influence');
  }
  if (lowered.includes('x')) {
    notes.push('wins material or removes an active enemy piece');
  }
  if (lowered.includes('+') || lowered.includes('#')) {
    notes.push('creates direct king pressure and forces defensive replies');
  }
  if (lowered === 'o-o' || lowered === 'o-o-o') {
    notes.push('improves king safety while connecting your rooks for the middlegame');
  }
  if (/^[nbrqk]/i.test(san)) {
    notes.push('develops a piece, so your army joins the game faster');
  } else if (!notes.length) {
    notes.push('improves your structure and prepares future tactical ideas');
  }

  return notes;
}

function buildDetailedCoachMessage(san, data) {
  const best = data.alternatives?.[0];
  const themes = describeMoveThemes(san);
  const delta = Math.round(data.scoreDelta ?? 0);
  const moveMeaning = describeSanForHumans(san);
  const bestMeaning = best?.san ? describeSanForHumans(best.san) : '';

  const opening = data.verdict === 'best'
    ? `${san} is an excellent choice in this position.`
    : `${san} is playable, but there is a stronger move available.`;

  const comparison = best
    ? `Stockfish's top recommendation is ${best.san}${bestMeaning ? ` (${bestMeaning})` : ''} (about ${delta} centipawns difference).`
    : 'No stronger continuation was available from this position.';

  const strategic = data.strategicIdea ? `Strategic idea: ${data.strategicIdea}` : '';
  const targetSummary = data.targetSummary ? ` ${data.targetSummary}` : '';

  return `${opening} Move meaning: ${moveMeaning}. Why it can work: ${themes.join('; ')}. ${strategic}${targetSummary} ${comparison} ${data.message}`.trim();
}

function describeSanForHumans(san) {
  if (!san) return 'unknown move';

  const clean = san.replace(/[+#?!]/g, '');
  if (clean === 'O-O') return 'king castles kingside';
  if (clean === 'O-O-O') return 'king castles queenside';

  const pieceNames = {
    K: 'king',
    Q: 'queen',
    R: 'rook',
    B: 'bishop',
    N: 'knight',
  };

  const destination = clean.match(/([a-h][1-8])$/)?.[1] || 'an unknown square';
  const isCapture = clean.includes('x');
  const lead = clean[0];
  const isPieceMove = Boolean(pieceNames[lead]);

  if (isPieceMove) {
    const piece = pieceNames[lead];
    return `${piece}${isCapture ? ' captures on' : ' moves to'} ${destination}`;
  }

  const fromFile = clean.match(/^([a-h])x/)?.[1];
  if (fromFile && isCapture) {
    return `pawn from the ${fromFile}-file captures on ${destination}`;
  }

  return `pawn moves to ${destination}`;
}

async function analyzeMove(san) {
  if (!isAdmin) return;

  chess.undo();
  const fenBefore = chess.fen();
  chess.move(san);

  try {
    const res = await fetch('/api/analyze-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: fenBefore, san }),
    });

    const data = await res.json();
    const best = data.alternatives?.[0];
    moveQualityLog.push({ san, loss: data.scoreDelta ?? 0, flags: '', result: data.verdict });

    coach.textContent = `Verdict: ${data.verdict}. ${buildDetailedCoachMessage(san, data)}`;
    logChat(buildDetailedCoachMessage(san, data));

    if (data.verdict !== 'best' && best?.san) {
      logChat(`Try this stronger idea next time: ${best.san}.`, 'Coach');
    }
  } catch {
    coach.textContent = 'Move analysis unavailable right now.';
  }
}

function resetForNewGame() {
  moveQualityLog = [];
  lastAnnouncedMove = null;
  botMoveRequestPending = false;
  clearSelection();
  clearChat();
  chess.reset();
  renderBoard();
  renderHistory();
  coach.textContent = isAdmin
    ? 'New game started. I will explain each move in detail.'
    : 'New game started.';
}

function createRoom() {
  const id = Math.random().toString(36).slice(2, 8);
  currentRoom = id;
  const remembered = localStorage.getItem('ct-player-name');
  playerName = (remembered || window.prompt('Enter your name for this room:', 'Guest') || 'Guest').trim() || 'Guest';
  localStorage.setItem('ct-player-name', playerName);

  const params = new URLSearchParams(window.location.search);
  params.set('room', id);
  window.history.replaceState({}, '', `?${params.toString()}`);
  roomLinkEl.textContent = `Share this link: ${window.location.href}`;
  updateAdminControls();
  resetForNewGame();
  joinRoom();
}

function joinRoom({ forcePrompt = false } = {}) {
  if (forcePrompt || !currentRoom) {
    const id = window.prompt('Enter room code to join:');
    if (!id) return;
    currentRoom = id.trim();
  }

  resolveIdentity();

  const params = new URLSearchParams(window.location.search);
  params.set('room', currentRoom);
  window.history.replaceState({}, '', `?${params.toString()}`);
  roomLinkEl.textContent = `Current room: ${currentRoom}`;

  socket.emit('join-room', {
    roomId: currentRoom,
    playerName,
    mode: playingBot ? 'bot' : 'pvp',
    bot: playingBot,
    adminToken: getAdminSessionToken(),
  });
  logChat(`Joined room ${currentRoom}.`, 'Game');
}


async function loginAsAdmin() {
  const username = window.prompt('Admin login name:', 'Gabriel');
  if (!username) return;

  const password = window.prompt('Admin password:', 'password');
  if (password == null) return;

  try {
    const res = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    setAdminSessionToken(data.token);
    coach.textContent = 'Admin login successful. Rejoin or create a room to use admin controls.';

    if (currentRoom) {
      joinRoom();
    } else {
      updateAdminControls();
    }
  } catch {
    coach.textContent = 'Admin login failed. Check username/password.';
  }
}

function logoutAdmin() {
  clearAdminSessionToken();
  isAdmin = false;
  updateAdminControls();
  coach.textContent = 'Admin session cleared on this device.';

  if (currentRoom) joinRoom();
}

socket.on('role-state', (role) => {
  isAdmin = Boolean(role?.isAdmin);
  updateAdminControls();

  if (!isAdmin) {
    coach.textContent = 'Admin-only analysis is locked for this player.';
  }
});

socket.on('room-state', (state) => {
  chess.load(state.fen);
  roomPlayers = state.players || [];
  clearSelection();
  renderBoard();
  renderHistory();

  if (!playingBot || state.turn === humanColor || state.gameOver) {
    botMoveRequestPending = false;
  }

  if (state.lastMove?.san && state.lastMove?.san !== lastAnnouncedMove) {
    const who = state.lastMoveBy || 'Player';
    logChat(`${who} moved ${state.lastMove.san}.`, 'Game');
    lastAnnouncedMove = state.lastMove.san;
  }

  if (state.gameOver) logChat('Game over.', 'Coach');
  maybeRequestBotMove();
});

socket.on('invalid-move', () => {
  coach.textContent = 'Move not made. Select one of the highlighted legal target squares.';
  renderBoard();
});

document.getElementById('newRoomBtn').onclick = () => {
  playingBot = null;
  createRoom();
};

document.getElementById('joinRoomBtn').onclick = () => {
  playingBot = null;
  joinRoom({ forcePrompt: true });
};

adminLoginBtn.onclick = () => {
  loginAsAdmin();
};

adminLogoutBtn.onclick = () => {
  logoutAdmin();
};

document.getElementById('playBotBtn').onclick = () => {
  const botValue = document.getElementById('botSelect').value;
  if (!botValue) {
    coach.textContent = 'No bot selected. Please load bots and try again.';
    return;
  }

  playingBot = JSON.parse(botValue);
  createRoom();
  logChat(`Playing against ${playingBot.name} at ${playingBot.rating} ELO.`, 'Game');
};

analyzeBtn.onclick = async () => {
  if (!isAdmin) return;
  const last = chess.history().at(-1);
  if (!last) return;
  await analyzeMove(last);
};

saveProfileBtn.onclick = async () => {
  if (!isAdmin) {
    coach.textContent = 'Only the room admin can save profiles.';
    return;
  }

  try {
    const me = playerName || 'Admin';
    const opponentInRoom = roomPlayers.find((p) => p.name !== me)?.name || 'Opponent';

    const resultA = chess.isCheckmate() ? (chess.turn() === 'b' ? 'win' : 'loss') : 'draw';
    const resultB = resultA === 'win' ? 'loss' : resultA === 'loss' ? 'win' : 'draw';

    const payload = playingBot
      ? {
        playerA: me,
        playerB: playingBot.name,
        gameType: 'bot',
        botRating: playingBot?.rating,
        moves: moveQualityLog,
        resultA,
        resultB,
        avgLossA: average(moveQualityLog.map((m) => m.loss)),
        avgLossB: average(moveQualityLog.map((m) => m.loss)) + 35,
      }
      : {
        playerA: opponentInRoom,
        playerB: me,
        gameType: 'pvp',
        moves: moveQualityLog,
        resultA: resultB,
        resultB: resultA,
        avgLossA: average(moveQualityLog.map((m) => m.loss)) + 20,
        avgLossB: average(moveQualityLog.map((m) => m.loss)),
      };

    const res = await fetch('/api/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, adminToken: getAdminSessionToken() }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    await loadBots();
    logChat(`${payload.playerA} rating updated to ${data.profile.rating} ELO.`, 'Coach');
  } catch {
    coach.textContent = 'Could not save profile.';
  }
};

function average(values) {
  if (!values.length) return 120;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

if (currentRoom) joinRoom();
updateAdminControls();
loadBots();
renderBoard();
