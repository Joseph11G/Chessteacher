import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { Chess } from 'chess.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PRESET_BOTS,
  chooseBotMove,
  explainMoveQuality,
  updateElo,
  buildProfileFromGame,
} from './src/engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const profilePath = path.join(__dirname, 'data', 'profiles.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const roomState = new Map();

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
  const dynamicProfiles = Object.entries(readProfiles()).map(([id, val]) => ({ id, ...val }));
  res.json({ preset: PRESET_BOTS, dynamic: dynamicProfiles });
});

app.post('/api/analyze-move', (req, res) => {
  const { fen, san } = req.body;
  if (!fen || !san) return res.status(400).json({ error: 'fen and san are required' });

  const analysis = explainMoveQuality(fen, san);
  res.json(analysis);
});

app.post('/api/update-profile', (req, res) => {
  const { playerA, playerB, moves, resultA, resultB, avgLossA = 120, avgLossB = 120 } = req.body;
  if (!playerA || !playerB) return res.status(400).json({ error: 'player names required' });

  const id = `${playerA.trim().toLowerCase()}-vs-${playerB.trim().toLowerCase()}`;
  const profiles = readProfiles();
  const current = profiles[id] || {
    name: `${playerA} vs ${playerB}`,
    rating: 800,
    games: 0,
    style: {},
  };

  const style = buildProfileFromGame(moves || []);
  const outcome = resultA === 'win' ? 1 : resultA === 'draw' ? 0.5 : 0;
  const inferredOpponent = 1200 + Math.max(0, 200 - avgLossA / 2);

  current.rating = updateElo(current.rating, inferredOpponent, outcome, 32, 100, 3000, true);
  current.games += 1;
  current.style = style;
  current.avgLossA = avgLossA;
  current.avgLossB = avgLossB;

  profiles[id] = current;
  writeProfiles(profiles);

  res.json({ id, profile: current });
});

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, playerName }) => {
    const existing = roomState.get(roomId) || {
      chess: new Chess(),
      players: [],
      history: [],
    };

    if (!existing.players.some((p) => p.id === socket.id)) {
      existing.players.push({ id: socket.id, name: playerName || `Player${existing.players.length + 1}` });
    }

    roomState.set(roomId, existing);
    socket.join(roomId);
    io.to(roomId).emit('room-state', {
      fen: existing.chess.fen(),
      players: existing.players,
      history: existing.history,
      turn: existing.chess.turn(),
    });
  });

  socket.on('make-move', ({ roomId, move }) => {
    const state = roomState.get(roomId);
    if (!state) return;

    const played = state.chess.move(move);
    if (!played) {
      socket.emit('invalid-move', { move });
      return;
    }

    state.history.push({ san: played.san, from: played.from, to: played.to, flags: played.flags });
    io.to(roomId).emit('room-state', {
      fen: state.chess.fen(),
      players: state.players,
      history: state.history,
      turn: state.chess.turn(),
      lastMove: played,
      gameOver: state.chess.isGameOver(),
    });
  });

  socket.on('bot-move', ({ roomId, bot }) => {
    const state = roomState.get(roomId);
    if (!state || state.chess.isGameOver()) return;

    const chosen = chooseBotMove(state.chess.fen(), bot);
    if (!chosen) return;
    const played = state.chess.move({ from: chosen.from, to: chosen.to, promotion: 'q' });

    state.history.push({ san: played.san, from: played.from, to: played.to, flags: played.flags, by: bot.name });
    io.to(roomId).emit('room-state', {
      fen: state.chess.fen(),
      players: state.players,
      history: state.history,
      turn: state.chess.turn(),
      lastMove: played,
      gameOver: state.chess.isGameOver(),
    });
  });

  socket.on('disconnect', () => {
    for (const [roomId, state] of roomState.entries()) {
      state.players = state.players.filter((p) => p.id !== socket.id);
      if (!state.players.length) {
        roomState.delete(roomId);
      } else {
        roomState.set(roomId, state);
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`ChessTeacher running on http://localhost:${port}`);
});
