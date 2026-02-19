import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { PRESET_BOTS, updateElo, rankMoves, buildProfileFromGame } from '../src/engine.js';

test('preset bots include seven tiers ending at 3000', () => {
  assert.equal(PRESET_BOTS.length, 7);
  assert.equal(PRESET_BOTS[0].rating, 200);
  assert.equal(PRESET_BOTS.at(-1).rating, 3000);
});

test('elo update in no-decrease mode does not drop rating', () => {
  const next = updateElo(1200, 1600, 0, 32, 100, 3000, true);
  assert.equal(next, 1200);
});

test('rankMoves returns legal options', () => {
  const chess = new Chess();
  const ranked = rankMoves(chess.fen(), 1, 3);
  assert.ok(ranked.length > 0);
  const legalSan = new Set(chess.moves());
  assert.ok(legalSan.has(ranked[0].san));
});

test('profile extraction returns bounded fields', () => {
  const style = buildProfileFromGame([
    { san: 'Qh5+', flags: 'n', loss: 30 },
    { san: 'Bxf7+', flags: 'c', loss: 15 },
  ]);
  assert.ok(style.aggression >= 0 && style.aggression <= 100);
  assert.ok(style.tactical >= 0 && style.tactical <= 100);
});
