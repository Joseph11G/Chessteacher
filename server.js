import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import {
  PRESET_BOTS,
  chooseBotMove,
  explainMoveQuality,
  updateElo,
  buildProfileFromGame,
} from './src/engine.js';
import { StockfishService } from './src/stockfish.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const profilePath = path.join(__dirname, 'data', 'profiles.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/chess.js', express.static(path.join(__dirname, 'node_modules', 'chess.js', 'dist', 'esm')));

const roomState = new Map();
const stockfish = new StockfishService();
const adminSessions = new Map();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Gabriel';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

function getLanIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        ips.push(address.address);
      }
    }
  }

  return [...new Set(ips)];
}


function createAdminSession(username) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 18)}`;
  adminSessions.set(token, { username, createdAt: Date.now() });
  return token;
}

function isValidAdminToken(token) {
  if (!token) return false;
  return adminSessions.has(token);
}

function readProfiles() {
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeProfiles(data) {
  fs.writeFileSync(profilePath, JSON.stringify(data, null, 2));
}

app.get('/api/bots', (_req, res) => {
  const dynamicProfiles = Object.entries(readProfiles())
    .map(([id, val]) => ({ id, ...val }))
    .filter((profile) => profile.gameType === 'bot');
  res.json({ preset: PRESET_BOTS, dynamic: dynamicProfiles });
});


app.post('/api/admin-login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    const token = createAdminSession(username);
    return res.json({ token, username });
  }

  return res.status(401).json({ error: 'Invalid admin credentials' });
});

app.post('/api/analyze-move', async (req, res) => {
  const { fen, san } = req.body;
  if (!fen || !san) return res.status(400).json({ error: 'fen and san are required' });

  try {
    const analysis = await stockfish.explainMoveQuality(fen, san);
    res.json(analysis);
  } catch {
    const analysis = explainMoveQuality(fen, san);
    res.json({ ...analysis, source: 'lightweight' });
  }
});

app.post('/api/update-profile', (req, res) => {
  const {
    playerA,
    playerB,
    gameType = 'pvp',
    botRating,
    moves,
    resultA,
    resultB,
    avgLossA = 120,
    avgLossB = 120,
    adminToken,
  } = req.body;
  if (!playerA || !playerB) return res.status(400).json({ error: 'player names required' });
  if (!isValidAdminToken(adminToken)) return res.status(403).json({ error: 'Admin login required' });

  const normalizedA = playerA.trim().toLowerCase();
  const normalizedB = playerB.trim().toLowerCase();
  const id = gameType === 'bot'
    ? `${normalizedA}-vs-bot-${normalizedB}`
    : `${normalizedA}-vs-${normalizedB}`;

  const profiles = readProfiles();
  const current = profiles[id] || {
    name: gameType === 'bot' ? `${playerA} vs ${playerB} bot` : `${playerA} vs ${playerB}`,
    rating: 800,
    games: 0,
    style: {},
    gameType,
  };

  const style = buildProfileFromGame(moves || []);
  const outcome = resultA === 'win' ? 1 : resultA === 'draw' ? 0.5 : 0;
  const inferredOpponent = gameType === 'bot' && Number.isFinite(botRating)
    ? Number(botRating)
    : 1200 + Math.max(0, 200 - avgLossA / 2);

  current.rating = updateElo(current.rating, inferredOpponent, outcome, 32, 100, 3000, true);
  current.games += 1;
  current.style = style;
  current.avgLossA = avgLossA;
  current.avgLossB = avgLossB;
  current.gameType = gameType;

  profiles[id] = current;
  writeProfiles(profiles);

  res.json({ id, profile: current });
});

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, playerName, mode = 'pvp', bot = null, adminToken = null }) => {
    const existing = roomState.get(roomId) || {
      chess: new Chess(),
      players: [],
      history: [],
      mode: 'pvp',
      bot: null,
      adminSocketId: null,
    };

    if (!existing.players.some((p) => p.id === socket.id)) {
      existing.players.push({ id: socket.id, name: playerName || `Player${existing.players.length + 1}` });
    }

    if (mode === 'bot') {
      existing.mode = 'bot';
      existing.bot = bot || existing.bot;
    }

    const isAdmin = isValidAdminToken(adminToken);
    if (isAdmin) existing.adminSocketId = socket.id;

    roomState.set(roomId, existing);
    socket.join(roomId);
    socket.emit('role-state', { isAdmin });

    io.to(roomId).emit('room-state', {
      fen: existing.chess.fen(),
      players: existing.players,
      history: existing.history,
      turn: existing.chess.turn(),
      mode: existing.mode,
    });
  });

  socket.on('make-move', ({ roomId, move }) => {
    const state = roomState.get(roomId);
    if (!state) return;

    if (state.mode === 'bot' && state.chess.turn() === 'b') {
      socket.emit('invalid-move', { move });
      return;
    }

    const played = state.chess.move(move);
    if (!played) {
      socket.emit('invalid-move', { move });
      return;
    }

    state.history.push({ san: played.san, from: played.from, to: played.to, flags: played.flags });
    const player = state.players.find((p) => p.id === socket.id);

    io.to(roomId).emit('room-state', {
      fen: state.chess.fen(),
      players: state.players,
      history: state.history,
      turn: state.chess.turn(),
      lastMove: played,
      lastMoveBy: player?.name || 'Player',
      gameOver: state.chess.isGameOver(),
    });

    if (state.mode === 'bot' && !state.chess.isGameOver() && state.chess.turn() === 'b') {
      setTimeout(() => {
        const fresh = roomState.get(roomId);
        if (!fresh || fresh.mode !== 'bot' || fresh.chess.isGameOver() || fresh.chess.turn() !== 'b') return;

        const activeBot = fresh.bot;
        if (!activeBot) return;

        const chosen = chooseBotMove(fresh.chess.fen(), activeBot);
        if (!chosen) return;

        const botPlayed = fresh.chess.move({ from: chosen.from, to: chosen.to, promotion: 'q' });
        if (!botPlayed) return;

        fresh.history.push({
          san: botPlayed.san,
          from: botPlayed.from,
          to: botPlayed.to,
          flags: botPlayed.flags,
          by: activeBot.name,
        });

        io.to(roomId).emit('room-state', {
          fen: fresh.chess.fen(),
          players: fresh.players,
          history: fresh.history,
          turn: fresh.chess.turn(),
          lastMove: botPlayed,
          lastMoveBy: activeBot?.name || 'Bot',
          gameOver: fresh.chess.isGameOver(),
        });
      }, 250);
    }
  });

  socket.on('bot-move', ({ roomId, bot }) => {
    const state = roomState.get(roomId);
    if (!state || state.chess.isGameOver()) return;
    if (state.mode !== 'bot' || state.chess.turn() !== 'b') return;

    const activeBot = bot || state.bot;
    if (!activeBot) return;

    const chosen = chooseBotMove(state.chess.fen(), activeBot);
    if (!chosen) return;
    const played = state.chess.move({ from: chosen.from, to: chosen.to, promotion: 'q' });

    state.history.push({ san: played.san, from: played.from, to: played.to, flags: played.flags, by: activeBot.name });

    io.to(roomId).emit('room-state', {
      fen: state.chess.fen(),
      players: state.players,
      history: state.history,
      turn: state.chess.turn(),
      lastMove: played,
      lastMoveBy: activeBot?.name || 'Bot',
      gameOver: state.chess.isGameOver(),
    });
  });

  socket.on('disconnect', () => {
    for (const [roomId, state] of roomState.entries()) {
      if (state.adminSocketId === socket.id) state.adminSocketId = null;
      state.players = state.players.filter((p) => p.id !== socket.id);
      if (!state.players.length) {
        roomState.delete(roomId);
      } else {
        roomState.set(roomId, state);
      }
    }
  });
});

const port = 7860;
const host = '0.0.0.0';

server.listen(port, host, () => {
  console.log(`ChessTeacher running on http://localhost:${port}`);

  const lanIps = getLanIps();
  if (lanIps.length) {
    for (const ip of lanIps) {
      console.log(`LAN access: http://${ip}:${port}`);
    }
  }
});
