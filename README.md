# ChessTeacher AI

A beginner-focused chess learning app with:

- AI move coaching with alternatives and reasons.
- 7 built-in bots from 200 to 3000 ELO.
- Player-vs-player room links for phone-to-phone games.
- Admin/owner mode for Gabriel (analysis + save tools are admin-only).
- Shared room links auto-join guests and keep creator controls private.
- Adaptive profile saving updates the correct player rating (Gabriel vs bot, opponent in PvP).

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


## Publish online for free (Render)

A simple free option for this project is **Render** (works with Express + Socket.IO out of the box).

1. Push your code to GitHub.
2. Create a free account at [render.com](https://render.com).
3. Click **New +** → **Web Service**.
4. Connect your GitHub repo and choose this project.
5. Use these settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. Add environment variables in Render dashboard:
   - `STOCKFISH_ENABLED=true`
   - `STOCKFISH_DEPTH=12`
   - `HOST=0.0.0.0`
   - `STOCKFISH_PATH=./bin/stockfish`
7. Deploy and open your public URL (for example `https://chessteacher.onrender.com`).

### Updating an existing Render service (already deployed)

If your site is already live on Render, use this quick upgrade flow:

1. Commit and push your latest changes to the same GitHub branch Render watches (usually `main`).
2. Open your Render service dashboard and click **Manual Deploy** → **Deploy latest commit** (or wait for auto-deploy if enabled).
3. Confirm these settings are still correct:
   - Build Command: `npm install && npm run install:stockfish`
   - Start Command: `npm start`
4. Confirm environment variables still include:
   - `HOST=0.0.0.0`
   - `STOCKFISH_ENABLED=true`
   - `STOCKFISH_PATH=./bin/stockfish`
5. After deploy completes, hard refresh your browser and test:
   - room link auto-join (`?room=xxxx`)
   - admin-only analyze/save controls
   - profile save behavior in bot and PvP

### How to carry Stockfish to Render (important)

Your local Windows `.exe` cannot run directly on Render because Render web services run on Linux. You have 2 practical options:

### Option A (recommended): download Linux Stockfish during Render build (no apt)

Render Node web services can fail on `apt-get`, so this repo includes a build-safe installer script.
Use this in Render:

- **Build Command**: `npm install && npm run install:stockfish`
- **Start Command**: `npm start`
- **Env vars**:
  - `STOCKFISH_ENABLED=true`
  - `STOCKFISH_PATH=./bin/stockfish`

The script downloads the latest official Linux Stockfish tarball and installs the executable to `bin/stockfish`.

### Option B: commit your own Linux Stockfish binary into the repo

If you prefer not to download during build, commit a Linux binary at `bin/stockfish` and keep:

```text
STOCKFISH_ENABLED=true
STOCKFISH_PATH=./bin/stockfish
```

Do **not** use your Windows `.exe`; it must be a Linux executable.

### Quick verify on Render

After deploy, call:

```bash
curl -X POST https://<your-render-url>/api/analyze-move \
  -H "Content-Type: application/json" \
  -d '{"fen":"rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1","san":"e5"}'
```

Check response has either:

```json
"source": "stockfish"
```

or

```json
"source": "lightweight"
```

`"lightweight"` means Stockfish was unavailable at runtime (path missing, binary failed, or Stockfish disabled).

### Notes for free plan

- Free instances can sleep when inactive, so first load may be slow.
- If Stockfish binary is not available in your Render environment, the app automatically falls back to the lightweight analyzer.

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

1. **Move quality analysis:** every move can be checked for best/good/inaccuracy with top alternatives, strategic ideas, and target-focused explanations.
2. **ELO engine:** bounded 100-3000 rating with no-decrease mode for improvement bots.
3. **Opponent profiling:** style extraction (aggression, tactical, consistency, opening speed).
4. **Adaptive rating persistence:** stored in `data/profiles.json`, with bot games updating Gabriel's rating and PvP saves updating the opponent's rating profile.
5. **7 preset bots:** 200, 700, 1200, 1700, 2200, 2600, 3000.
6. **Room links:** create and share `?room=xxxx` URL across phones; opening the link auto-joins that room.
7. **Admin-only coaching controls:** analyze/save features are available only to the room admin (Gabriel).
8. **Improved UI and interaction safety:** better colors, responsive layout, legal move highlighting, clearer room joining flow, and stricter bot-turn handling in bot games.

## Notes

- Lightweight minimax analysis remains available as automatic fallback for portability.
- Server-side Stockfish gives significantly stronger analysis quality.
