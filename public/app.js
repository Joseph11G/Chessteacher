import { Chess } from '/vendor/chess.js/chess.js';

const socket = io();
const chess = new Chess();

const pieceMap = {
  p: { w: '♙', b: '♟' },
  r: { w: '♖', b: '♜' },
  n: { w: '♘', b: '♞' },
  b: { w: '♗', b: '♝' },
  q: { w: '♕', b: '♛' },
  k: { w: '♔', b: '♚' },
};

let selectedSquare = null;
let legalTargets = [];
let currentRoom = new URLSearchParams(window.location.search).get('room') || null;
let playingBot = null;
let moveQualityLog = [];
let lastAnnouncedMove = null;

const boardEl = document.getElementById('board');
const historyEl = document.getElementById('history');
const roomLinkEl = document.getElementById('roomLink');
const chatLog = document.getElementById('chatLog');
const coach = document.getElementById('coach');

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
        const pieceEl = document.createElement('span');
        pieceEl.className = `piece ${piece.color === 'w' ? 'white' : 'black'}`;
        pieceEl.textContent = pieceMap[piece.type][piece.color];
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

  selectedSquare = square;
  legalTargets = chess.moves({ square, verbose: true }).map((move) => move.to);
  renderBoard();
}

function clearSelection() {
  selectedSquare = null;
  legalTargets = [];
}

function onSquareClick(square) {
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
  analyzeMove(played.san);

  if (playingBot && !chess.isGameOver()) {
    setTimeout(() => socket.emit('bot-move', { roomId: currentRoom, bot: playingBot }), 350);
  }
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

  const opening = data.verdict === 'best'
    ? `${san} is an excellent choice in this position.`
    : `${san} is playable, but there is a stronger move available.`;

  const comparison = best
    ? `Stockfish's top recommendation is ${best.san} (about ${delta} centipawns difference).`
    : 'No stronger continuation was available from this position.';

  return `${opening} Why it can work: ${themes.join('; ')}. ${comparison} ${data.message}`;
}

async function analyzeMove(san) {
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
  clearSelection();
  clearChat();
  coach.textContent = 'New game started. I will explain each move in detail.';
}

function createRoom() {
  const id = Math.random().toString(36).slice(2, 8);
  currentRoom = id;
  const params = new URLSearchParams(window.location.search);
  params.set('room', id);
  window.history.replaceState({}, '', `?${params.toString()}`);
  roomLinkEl.textContent = `Share this link: ${window.location.href}`;
  resetForNewGame();
  joinRoom();
}

function joinRoom() {
  if (!currentRoom) {
    const id = window.prompt('Enter room code to join:');
    if (!id) return;
    currentRoom = id.trim();
  }

  const params = new URLSearchParams(window.location.search);
  params.set('room', currentRoom);
  window.history.replaceState({}, '', `?${params.toString()}`);
  roomLinkEl.textContent = `Current room: ${currentRoom}`;

  const playerName = document.getElementById('playerName').value || 'Player';
  socket.emit('join-room', { roomId: currentRoom, playerName });
  logChat(`Joined room ${currentRoom}.`);
}

socket.on('room-state', (state) => {
  chess.load(state.fen);
  clearSelection();
  renderBoard();
  renderHistory();

  if (state.lastMove?.san && state.lastMove?.san !== lastAnnouncedMove) {
    const who = state.lastMoveBy || 'Player';
    logChat(`${who} moved ${state.lastMove.san}.`, 'Game');
    lastAnnouncedMove = state.lastMove.san;
  }

  if (state.gameOver) logChat('Game over. Save profile to grow your adaptive training bot.', 'Coach');
});

socket.on('invalid-move', () => {
  coach.textContent = 'Move not made. Select one of the highlighted legal target squares.';
  renderBoard();
});

document.getElementById('newRoomBtn').onclick = createRoom;
document.getElementById('joinRoomBtn').onclick = joinRoom;
document.getElementById('playBotBtn').onclick = () => {
  const botValue = document.getElementById('botSelect').value;
  if (!botValue) {
    coach.textContent = 'No bot selected. Please load bots and try again.';
    return;
  }

  playingBot = JSON.parse(botValue);
  if (!currentRoom) createRoom();
  joinRoom();
  logChat(`Playing against ${playingBot.name} at ${playingBot.rating} ELO.`);
};

document.getElementById('analyzeBtn').onclick = async () => {
  const last = chess.history().at(-1);
  if (!last) return;
  await analyzeMove(last);
};

document.getElementById('saveProfileBtn').onclick = async () => {
  try {
    const playerA = document.getElementById('playerName').value;
    const playerB = document.getElementById('opponentName').value;

    const resultA = chess.isCheckmate() ? (chess.turn() === 'b' ? 'win' : 'loss') : 'draw';
    const resultB = resultA === 'win' ? 'loss' : resultA === 'loss' ? 'win' : 'draw';

    const payload = {
      playerA,
      playerB,
      moves: moveQualityLog,
      resultA,
      resultB,
      avgLossA: average(moveQualityLog.map((m) => m.loss)),
      avgLossB: average(moveQualityLog.map((m) => m.loss)) + 35,
    };

    const res = await fetch('/api/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    await loadBots();
    logChat(`Adaptive bot updated: ${data.profile.name} now ${data.profile.rating} ELO.`);
  } catch {
    coach.textContent = 'Could not save adaptive bot profile.';
  }
};

function average(values) {
  if (!values.length) return 120;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

if (currentRoom) joinRoom();
loadBots();
renderBoard();
