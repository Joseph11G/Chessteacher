# ChessTeacher AI

A beginner-focused chess learning app with:

- AI move coaching with alternatives and reasons.
- 7 built-in bots from 200 to 3000 ELO.
- Player-vs-player room links for phone-to-phone games.
- Adaptive profile bot creation from named players (e.g., Gabriel vs Godson) that updates after each game.
- Non-decreasing adaptive bot rating to track improvement.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Features implemented

1. **Move quality analysis:** every move can be checked for best/good/inaccuracy with top alternatives.
2. **ELO engine:** bounded 100-3000 rating with no-decrease mode for improvement bots.
3. **Opponent profiling:** style extraction (aggression, tactical, consistency, opening speed).
4. **Adaptive bot persistence:** stored in `data/profiles.json` and reused/updated by same `playerA-vs-playerB` key.
5. **7 preset bots:** 200, 700, 1200, 1700, 2200, 2600, 3000.
6. **Room links:** create and share `?room=xxxx` URL across phones.
7. **3D-styled board/pieces:** high-depth shading and pseudo-3D visuals.

## Notes

- Current chess AI is a lightweight minimax evaluator (no heavy external engine dependency).
- For stronger analysis, you can later integrate Stockfish on server side.
