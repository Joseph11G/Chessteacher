import { Chess } from 'chess.js';

const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5']);

export const PRESET_BOTS = [
  { id: 'bot-200', name: 'Pawn Rookie', rating: 200, depth: 1, blunderChance: 0.45 },
  { id: 'bot-700', name: 'Knight Cadet', rating: 700, depth: 1, blunderChance: 0.25 },
  { id: 'bot-1200', name: 'Bishop Learner', rating: 1200, depth: 2, blunderChance: 0.15 },
  { id: 'bot-1700', name: 'Rook Strategist', rating: 1700, depth: 2, blunderChance: 0.1 },
  { id: 'bot-2200', name: 'Queen Master', rating: 2200, depth: 3, blunderChance: 0.06 },
  { id: 'bot-2600', name: 'Grandmaster Ghost', rating: 2600, depth: 3, blunderChance: 0.02 },
  { id: 'bot-3000', name: 'Impossible 3000', rating: 3000, depth: 4, blunderChance: 0 },
];

function evaluatePosition(chess) {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -99999 : 99999;
  }
  if (chess.isDraw() || chess.isStalemate() || chess.isThreefoldRepetition()) {
    return 0;
  }

  const board = chess.board();
  let score = 0;

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank][file];
      if (!piece) continue;

      const base = PIECE_VALUES[piece.type];
      const square = `${String.fromCharCode(97 + file)}${8 - rank}`;
      let bonus = 0;

      if (CENTER_SQUARES.has(square)) bonus += 20;
      if (piece.type === 'p') {
        bonus += piece.color === 'w' ? (6 - rank) * 5 : (rank - 1) * 5;
      }

      const signed = (base + bonus) * (piece.color === 'w' ? 1 : -1);
      score += signed;
    }
  }

  const mobility = chess.moves().length * (chess.turn() === 'w' ? 1 : -1) * 2;
  return score + mobility;
}

function minimax(chess, depth, alpha, beta, maximizing) {
  if (depth === 0 || chess.isGameOver()) {
    return { score: evaluatePosition(chess) };
  }

  const moves = chess.moves({ verbose: true });
  let bestMove = null;

  if (maximizing) {
    let bestScore = -Infinity;
    for (const move of moves) {
      chess.move(move);
      const { score } = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    }
    return { score: bestScore, move: bestMove };
  }

  let bestScore = Infinity;
  for (const move of moves) {
    chess.move(move);
    const { score } = minimax(chess, depth - 1, alpha, beta, true);
    chess.undo();

    if (score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
    beta = Math.min(beta, bestScore);
    if (beta <= alpha) break;
  }
  return { score: bestScore, move: bestMove };
}

export function rankMoves(fen, depth = 2, limit = 3) {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });

  const ranked = moves.map((move) => {
    chess.move(move);
    const result = minimax(chess, Math.max(depth - 1, 0), -Infinity, Infinity, chess.turn() === 'w');
    chess.undo();

    return {
      san: move.san,
      from: move.from,
      to: move.to,
      flags: move.flags,
      score: result.score,
    };
  });

  const whiteToMove = chess.turn() === 'w';
  ranked.sort((a, b) => (whiteToMove ? b.score - a.score : a.score - b.score));
  return ranked.slice(0, limit);
}

export function chooseBotMove(fen, bot) {
  const depth = bot?.depth ?? 1;
  const topMoves = rankMoves(fen, depth, 6);

  if (!topMoves.length) return null;

  const shouldBlunder = Math.random() < (bot?.blunderChance ?? 0);
  if (shouldBlunder && topMoves.length > 2) {
    return topMoves[topMoves.length - 1];
  }
  return topMoves[0];
}


function identifyTargets(chess, playedMove) {
  const targets = [];
  const attackerColor = playedMove.color;
  const board = chess.board();

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank][file];
      if (!piece || piece.color === attackerColor) continue;
      const square = `${String.fromCharCode(97 + file)}${8 - rank}`;
      if (chess.isAttacked(square, attackerColor)) {
        targets.push({ square, piece: piece.type, value: PIECE_VALUES[piece.type] ?? 0 });
      }
    }
  }

  return targets.sort((a, b) => b.value - a.value);
}

function describeStrategicIdea(move, target) {
  if (move.san.includes('#')) return 'It delivers checkmate, so the game ends immediately.';
  if (move.san.includes('+')) return 'It gives check, forcing the king to respond and reducing your opponent\'s options.';
  if (move.flags?.includes('k') || move.flags?.includes('q')) return 'It castles to improve king safety and activate your rook.';
  if (move.flags?.includes('c')) return 'It captures material, reducing your opponent\'s active resources.';
  if (target?.piece) {
    const pieceNames = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    return `It builds pressure on the ${pieceNames[target.piece] ?? 'piece'} on ${target.square}, creating tactical threats.`;
  }
  if (CENTER_SQUARES.has(move.to)) return 'It increases control of the center, giving your pieces better mobility.';
  if (/^[NBRQK]/.test(move.san)) return 'It develops a piece toward active squares for future attacks or defense.';
  return 'It improves coordination and keeps your position flexible for the next plan.';
}
export function explainMoveQuality(fen, san) {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });
  const played = legalMoves.find((m) => m.san === san);

  if (!played) {
    return {
      verdict: 'illegal',
      message: 'That move is not legal in this position.',
      alternatives: rankMoves(fen, 2, 3),
      strategicIdea: 'No strategic explanation because the move is illegal.',
      primaryTarget: null,
      targetSummary: 'No target identified.',
    };
  }

  const alternatives = rankMoves(fen, 2, 3);
  chess.move(played);
  const afterScore = evaluatePosition(chess);
  const bestScore = alternatives[0]?.score ?? afterScore;

  const delta = Math.abs(bestScore - afterScore);
  let verdict = 'best';
  let reason = 'Great move. It keeps a strong balance of material, center control, and mobility.';

  if (delta > 220) {
    verdict = 'inaccuracy';
    reason = 'This move misses a stronger tactical or positional continuation.';
  } else if (delta > 90) {
    verdict = 'good';
    reason = 'Good idea, but there is an even stronger continuation.';
  }

  const targets = identifyTargets(chess, played);
  const primaryTarget = targets[0] || null;
  const strategicIdea = describeStrategicIdea(played, primaryTarget);
  const targetSummary = primaryTarget
    ? `Main target: ${primaryTarget.piece.toUpperCase()} on ${primaryTarget.square}.`
    : 'Main target: improves piece activity and board control.';

  return {
    verdict,
    scoreDelta: delta,
    message: reason,
    alternatives,
    strategicIdea,
    primaryTarget,
    targetSummary,
  };
}

export function updateElo(current, opponent, score, k = 28, floor = 100, cap = 3000, noDecrease = false) {
  const expected = 1 / (1 + 10 ** ((opponent - current) / 400));
  let next = current + k * (score - expected);
  if (noDecrease) next = Math.max(current, next);
  return Math.max(floor, Math.min(cap, Math.round(next)));
}

export function buildProfileFromGame(moves) {
  const profile = {
    aggression: 0,
    tactical: 0,
    consistency: 0,
    openingSpeed: 0,
  };

  if (!moves.length) return profile;

  let captures = 0;
  let checks = 0;
  let avgLoss = 0;

  moves.forEach((m) => {
    if (m.flags?.includes('c')) captures += 1;
    if (m.san?.includes('+') || m.san?.includes('#')) checks += 1;
    avgLoss += m.loss ?? 0;
  });

  profile.aggression = Math.min(100, Math.round((captures / moves.length) * 200));
  profile.tactical = Math.min(100, Math.round((checks / moves.length) * 250));
  profile.consistency = Math.max(1, 100 - Math.round(avgLoss / moves.length / 4));
  profile.openingSpeed = Math.min(100, Math.round((12 / Math.max(moves.length, 12)) * 100));

  return profile;
}
