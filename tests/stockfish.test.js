import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToWhiteCp, parseScore, uciToMove } from '../src/stockfish.js';

test('uciToMove parses basic and promotion UCI strings', () => {
  assert.deepEqual(uciToMove('e2e4'), { from: 'e2', to: 'e4', promotion: undefined });
  assert.deepEqual(uciToMove('a7a8q'), { from: 'a7', to: 'a8', promotion: 'q' });
});

test('parseScore handles cp and mate scores', () => {
  assert.equal(parseScore('info depth 10 score cp 23 pv e2e4 e7e5'), 23);
  assert.equal(parseScore('info depth 10 score mate 3 pv e2e4'), 99997);
  assert.equal(parseScore('info depth 10 score mate -2 pv e2e4'), -99998);
});

test('normalizeToWhiteCp flips score when black to move', () => {
  const fenWhite = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const fenBlack = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';

  assert.equal(normalizeToWhiteCp(50, fenWhite), 50);
  assert.equal(normalizeToWhiteCp(50, fenBlack), -50);
});
