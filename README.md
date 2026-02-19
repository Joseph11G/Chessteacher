# ChessTeacher AI

A beginner-focused chess learning app with:

- AI move coaching with alternatives and reasons.
- 7 built-in bots from 200 to 3000 ELO.
- Player-vs-player room links for phone-to-phone games.
- Adaptive profile bot creation from named players (e.g., Gabriel vs Godson) that updates after each game.
- Non-decreasing adaptive bot rating to track improvement.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Stockfish server-side analysis (recommended)

The `/api/analyze-move` endpoint now uses Stockfish server-side by default, and automatically falls back to the built-in lightweight evaluator if Stockfish is not available.

### 1) Windows setup (PowerShell only)

If you downloaded the Stockfish `.exe` from the official website (for example `stockfish-windows-x86-64-avx2.exe`), this is what to do:

1. Create a folder for Stockfish and move the `.exe` there.
2. (Recommended) Rename the file to `stockfish.exe` so commands are simpler.
3. Test that the executable runs from PowerShell.

Use these exact PowerShell commands (edit path if needed):

```powershell
# 1) Create a folder for stockfish
New-Item -ItemType Directory -Force -Path "C:\tools\stockfish"

# 2) Move your downloaded file into that folder
Move-Item "C:\Users\<YOUR_WINDOWS_USERNAME>\Downloads\stockfish-windows-x86-64-avx2.exe" "C:\tools\stockfish\"

# 3) Rename to stockfish.exe (optional but recommended)
Rename-Item "C:\tools\stockfish\stockfish-windows-x86-64-avx2.exe" "stockfish.exe"

# 4) Confirm it runs (you should see Stockfish text output)
& "C:\tools\stockfish\stockfish.exe"
```

When it starts, type `quit` and press Enter to close it.

### 2) Configure environment variables in PowerShell (no `.env` file required)

You do **not** need a `.env` file for this project. Set environment variables directly in the same PowerShell window before `npm start`.

Variables you can set:

- `STOCKFISH_ENABLED` (default: `true`) — set to `false` to force lightweight analysis.
- `STOCKFISH_PATH` (default: `stockfish`) — path to the Stockfish binary.
- `STOCKFISH_DEPTH` (default: `12`) — analysis depth for server evaluations.

```powershell
# Tell app where stockfish.exe is
$env:STOCKFISH_PATH="C:\tools\stockfish\stockfish.exe"

# Optional tuning
$env:STOCKFISH_DEPTH="14"
$env:STOCKFISH_ENABLED="true"

# Start app in same PowerShell session
npm start
```

If you open a new PowerShell window later, set these variables again (unless you save them permanently).

To save them permanently for your user account:

```powershell
[Environment]::SetEnvironmentVariable("STOCKFISH_PATH", "C:\tools\stockfish\stockfish.exe", "User")
[Environment]::SetEnvironmentVariable("STOCKFISH_DEPTH", "14", "User")
[Environment]::SetEnvironmentVariable("STOCKFISH_ENABLED", "true", "User")
```

Then close and reopen PowerShell.

### 3) Verify which analysis engine was used

When you analyze a move, the API response includes a `source` field:

- `"stockfish"` when Stockfish was used.
- `"lightweight"` when fallback mode was used.

Quick check in PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/analyze-move" `
  -ContentType "application/json" `
  -Body '{"fen":"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1","san":"e5"}'
```

Look at the returned JSON:

- `"source": "stockfish"` means your `.exe` is configured correctly.
- `"source": "lightweight"` means Stockfish was not found/used (check `STOCKFISH_PATH`).

## Play on your phone while server runs on your PC

1. Make sure your PC and phone are on the same Wi-Fi network.
2. Start the server bound to all network interfaces:

   ```bash
   HOST=0.0.0.0 npm start
   ```

   On Windows PowerShell:

   ```powershell
   $env:HOST="0.0.0.0"
   npm start
   ```

3. Find your PC LAN IP:

   ```bash
   hostname -I
   ```

   Alternatives:

   - macOS: `ipconfig getifaddr en0`
   - Windows CMD: `ipconfig`
   - Windows PowerShell: `(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notmatch 'Loopback'}).IPAddress`

   Example output: `192.168.1.24`.
4. On your phone browser, open:

   `http://<YOUR_PC_IP>:3000`

   Example: `http://192.168.1.24:3000`
5. If it does not load:
   - Allow Node.js through your OS firewall for private networks.
   - Disable VPN/proxy apps temporarily.
   - Confirm your phone is on the same subnet as your PC (for example both `192.168.1.x`).
   - Check server logs: it now prints `LAN access: http://...` addresses you can open directly on your phone.

## Features implemented

1. **Move quality analysis:** every move can be checked for best/good/inaccuracy with top alternatives.
2. **ELO engine:** bounded 100-3000 rating with no-decrease mode for improvement bots.
3. **Opponent profiling:** style extraction (aggression, tactical, consistency, opening speed).
4. **Adaptive bot persistence:** stored in `data/profiles.json` and reused/updated by same `playerA-vs-playerB` key.
5. **7 preset bots:** 200, 700, 1200, 1700, 2200, 2600, 3000.
6. **Room links:** create and share `?room=xxxx` URL across phones.
7. **Improved UI and interaction safety:** better colors, responsive layout, legal move highlighting, and clearer room joining flow.

## Notes

- Lightweight minimax analysis remains available as automatic fallback for portability.
- Server-side Stockfish gives significantly stronger analysis quality.
