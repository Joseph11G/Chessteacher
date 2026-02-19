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
let currentRoom = new URLSearchParams(window.location.search).get('room') || null;
let playingBot = null;
let moveQualityLog = [];

const boardEl = document.getElementById('board');
const historyEl = document.getElementById('history');
const roomLinkEl = document.getElementById('roomLink');
const chatLog = document.getElementById('chatLog');
const coach = document.getElementById('coach');

async function loadBots() {
  const res = await fetch('/api/bots');
  const data = await res.json();
  const select = document.getElementById('botSelect');
  select.innerHTML = '';

  [...data.preset, ...data.dynamic].forEach((bot) => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify(bot);
    opt.textContent = `${bot.name} (${bot.rating} ELO)`;
    select.appendChild(opt);
  });
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
      const square = document.createElement('div');
      const algebraic = `${String.fromCharCode(97 + file)}${8 - rank}`;
      square.dataset.square = algebraic;
      square.className = `square ${(rank + file) % 2 === 0 ? 'light' : 'dark'}`;
      if (selectedSquare === algebraic) square.classList.add('selected');

      const piece = board[rank][file];
      square.textContent = piece ? pieceMap[piece.type][piece.color] : '';

      square.onclick = () => onSquareClick(algebraic);
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

function onSquareClick(square) {
  if (!selectedSquare) {
    selectedSquare = square;
    renderBoard();
    return;
  }

  const move = { from: selectedSquare, to: square, promotion: 'q' };
  selectedSquare = null;

  const played = chess.move(move);
  if (!played) {
    renderBoard();
    return;
  }

  socket.emit('make-move', { roomId: currentRoom, move });
  renderBoard();
  renderHistory();
  analyzeMove(played.san);

  if (playingBot && !chess.isGameOver()) {
    setTimeout(() => {
      socket.emit('bot-move', { roomId: currentRoom, bot: playingBot });
    }, 350);
  }
}

async function analyzeMove(san) {
  const before = chess.fen();
  chess.undo();
  const fenBefore = chess.fen();
  chess.move(san);

  const res = await fetch('/api/analyze-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fen: fenBefore, san }),
  });

  const data = await res.json();
  const best = data.alternatives?.[0];
  moveQualityLog.push({ san, loss: data.scoreDelta ?? 0, flags: '', result: data.verdict });

  coach.textContent = `Verdict: ${data.verdict}. ${data.message}`;
  logChat(
    data.verdict === 'best'
      ? `${san} is excellent. Keep building this habit.`
      : `${san} works, but consider ${best?.san} next time. Why: better activity and safer king structure.`
  );

  return before;
}

function createRoom() {
  const id = Math.random().toString(36).slice(2, 8);
  currentRoom = id;
  const params = new URLSearchParams(window.location.search);
  params.set('room', id);
  window.history.replaceState({}, '', `?${params.toString()}`);
  roomLinkEl.textContent = `Share this link: ${window.location.href}`;
  joinRoom();
}

function joinRoom() {
  if (!currentRoom) {
    alert('Create a room first or provide ?room=XXXX in URL');
    return;
  }
  const playerName = document.getElementById('playerName').value || 'Player';
  socket.emit('join-room', { roomId: currentRoom, playerName });
  logChat(`Joined room ${currentRoom}.`);
}

socket.on('room-state', (state) => {
  chess.load(state.fen);
  renderBoard();
  renderHistory();

  if (state.lastMove) {
    logChat(`Move played: ${state.lastMove.san}`, 'Game');
  }

  if (state.gameOver) {
    logChat('Game over. Save profile to grow your adaptive training bot.', 'Coach');
  }
});

document.getElementById('newRoomBtn').onclick = createRoom;
document.getElementById('joinRoomBtn').onclick = joinRoom;
document.getElementById('playBotBtn').onclick = () => {
  playingBot = JSON.parse(document.getElementById('botSelect').value);
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
  logChat(`Adaptive bot updated: ${data.profile.name} now ${data.profile.rating} ELO with style ${JSON.stringify(data.profile.style)}`);
};

function average(values) {
  if (!values.length) return 120;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

if (currentRoom) joinRoom();
loadBots();
renderBoard();
