import { spawn } from 'child_process';
import { Chess } from 'chess.js';

function parseScore(line) {
  const mateMatch = line.match(/\bscore mate (-?\d+)/);
  if (mateMatch) {
    const mate = Number(mateMatch[1]);
    return mate > 0 ? 100000 - mate : -100000 - mate;
  }

  const cpMatch = line.match(/\bscore cp (-?\d+)/);
  if (cpMatch) return Number(cpMatch[1]);
  return null;
}

function uciToMove(uci) {
  if (!uci || uci.length < 4) return null;
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4],
  };
}

function normalizeToWhiteCp(cp, fen) {
  const turn = fen.split(' ')[1];
  return turn === 'w' ? cp : -cp;
}

async function runStockfishCommand({ stockfishPath, fen, depth = 12, multiPv = 1 }) {
  return new Promise((resolve, reject) => {
    const engine = spawn(stockfishPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const infos = [];

    let stdoutBuffer = '';
    let stderrBuffer = '';

    const onData = (chunk) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith('info ') && line.includes(' pv ')) {
          infos.push(line);
        }

        if (line.startsWith('bestmove')) {
          const bestmove = line.split(/\s+/)[1];
          engine.stdin.write('quit\n');
          resolve({ infos, bestmove, stderr: stderrBuffer.trim() });
        }
      }
    };

    engine.stdout.on('data', onData);
    engine.stderr.on('data', (chunk) => {
      stderrBuffer += chunk.toString();
    });

    engine.on('error', (error) => reject(error));
    engine.on('close', (code) => {
      if (code !== 0 && infos.length === 0) {
        reject(new Error(`Stockfish exited with code ${code}. ${stderrBuffer}`));
      }
    });

    engine.stdin.write('uci\n');
    engine.stdin.write('isready\n');
    engine.stdin.write('setoption name Threads value 1\n');
    engine.stdin.write('setoption name Hash value 16\n');
    engine.stdin.write(`setoption name MultiPV value ${multiPv}\n`);
    engine.stdin.write(`position fen ${fen}\n`);
    engine.stdin.write(`go depth ${depth}\n`);
  });
}

function parseMultiPv(infos, fen, limit = 3) {
  const bestByPv = new Map();

  for (const line of infos) {
    const pvMatch = line.match(/\bmultipv (\d+)/);
    const pvNumber = pvMatch ? Number(pvMatch[1]) : 1;
    const movesPart = line.split(' pv ')[1];
    if (!movesPart) continue;

    const firstUci = movesPart.split(/\s+/)[0];
    const move = uciToMove(firstUci);
    if (!move) continue;

    const cp = parseScore(line);
    if (cp === null) continue;

    const chess = new Chess(fen);
    const played = chess.move(move);
    if (!played) continue;

    bestByPv.set(pvNumber, {
      san: played.san,
      from: played.from,
      to: played.to,
      flags: played.flags,
      score: normalizeToWhiteCp(cp, fen),
    });
  }

  return [...bestByPv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, move]) => move)
    .slice(0, limit);
}


const PIECE_NAMES = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
};

function identifyTargets(chess, move) {
  const targets = [];
  const board = chess.board();

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank][file];
      if (!piece || piece.color === move.color) continue;

      const square = `${String.fromCharCode(97 + file)}${8 - rank}`;
      if (chess.isAttacked(square, move.color)) {
        targets.push({ square, piece: piece.type });
      }
    }
  }

  return targets;
}

function buildStrategicIdea(move, target) {
  if (move.san.includes('#')) return 'This move checkmates, which makes it the most forcing move possible.';
  if (move.san.includes('+')) return 'This move gives check and forces your opponent to answer the king threat first.';
  if (move.flags.includes('k') || move.flags.includes('q')) return 'This castling move protects your king and activates a rook.';
  if (move.flags.includes('c')) return 'This move wins material and removes an active defender or attacker.';
  if (target) return `This move creates pressure on the ${PIECE_NAMES[target.piece] ?? 'piece'} at ${target.square}.`;
  return 'This move improves coordination, space, and future tactical chances.';
}

export class StockfishService {
  constructor({ stockfishPath, depth = 12, enabled = true } = {}) {
    this.stockfishPath = stockfishPath || 'stockfish';
    this.depth = Number(process.env.STOCKFISH_DEPTH || depth);
    this.enabled = String(process.env.STOCKFISH_ENABLED ?? enabled) !== 'false';
  }

  async analyzeFen(fen, { multiPv = 1 } = {}) {
    if (!this.enabled) throw new Error('Stockfish disabled');

    const { infos, bestmove } = await runStockfishCommand({
      stockfishPath: this.stockfishPath,
      fen,
      depth: this.depth,
      multiPv,
    });

    const bestLine = parseMultiPv(infos, fen, 1)[0];
    return {
      bestmove,
      score: bestLine?.score ?? 0,
      lines: parseMultiPv(infos, fen, multiPv),
    };
  }

  async explainMoveQuality(fen, san) {
    const chess = new Chess(fen);
    const legalMoves = chess.moves({ verbose: true });
    const played = legalMoves.find((m) => m.san === san);

    if (!played) {
      const { lines } = await this.analyzeFen(fen, { multiPv: 3 });
      return {
        verdict: 'illegal',
        message: 'That move is not legal in this position.',
        alternatives: lines,
        source: 'stockfish',
        strategicIdea: 'No strategic explanation because the move is illegal.',
        primaryTarget: null,
        targetSummary: 'No target identified.',
      };
    }

    const bestMoves = await this.analyzeFen(fen, { multiPv: 3 });
    const best = bestMoves.lines[0];

    chess.move({ from: played.from, to: played.to, promotion: played.promotion ?? 'q' });
    const playedEval = await this.analyzeFen(chess.fen(), { multiPv: 1 });

    const delta = Math.abs((best?.score ?? playedEval.score) - playedEval.score);

    let verdict = 'best';
    let reason = 'Great move. It matches Stockfish best play in this position.';

    if (delta > 180) {
      verdict = 'inaccuracy';
      reason = 'This move gives away notable evaluation compared with the best continuation.';
    } else if (delta > 70) {
      verdict = 'good';
      reason = 'Playable move, but Stockfish finds a stronger continuation.';
    }

    const targets = identifyTargets(chess, played);
    const primaryTarget = targets[0] || null;
    const strategicIdea = buildStrategicIdea(played, primaryTarget);
    const targetSummary = primaryTarget
      ? `Main target: ${PIECE_NAMES[primaryTarget.piece]?.toUpperCase() || primaryTarget.piece.toUpperCase()} on ${primaryTarget.square}.`
      : 'Main target: improve activity and control key squares.';

    return {
      verdict,
      scoreDelta: delta,
      message: reason,
      alternatives: bestMoves.lines,
      source: 'stockfish',
      strategicIdea,
      primaryTarget,
      targetSummary,
    };
  }
}

export { normalizeToWhiteCp, parseScore, uciToMove };
