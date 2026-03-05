# StrikeAlert

Nuclear and missile threat monitoring PWA. Scans live news + USGS seismic data and alerts users when threat levels rise.

**Live at:** strikealert.app

---

## File Structure

```
/
├── server.js        Express API + static file server
├── monitor.js       Continuous RSS + seismic scanner
├── state.json       Live threat state (auto-updated)
├── monitor.log      Activity log
├── package.json
└── public/
    ├── index.html   PWA shell
    ├── app.jsx      React frontend (no build needed)
    ├── manifest.json
    ├── sw.js        Service worker
    ├── icon-192.png (add your own)
    └── icon-512.png (add your own)
```

---

## Local Development

```bash
npm install
npm run dev          # Starts both server + monitor in parallel
```

Then open http://localhost:3000

---

## Hostinger Deployment (Node.js Hosting)

### 1. Upload files

Upload all files to your Hostinger Node.js hosting root via FTP or Git.

### 2. Set Node.js version

In Hostinger hPanel → Node.js → set version to **18.x or higher**.

### 3. Set startup file

In hPanel → Node.js → Application startup file → set to **server.js**

### 4. Install dependencies

In hPanel → Node.js → click **Run NPM install**, or SSH in and run:

```bash
npm install --production
```

### 5. Start the API server

In hPanel → Node.js → click **Start**. This runs `node server.js`.

### 6. Start the monitor as a background process

SSH into your server and run:

```bash
nohup node monitor.js >> monitor.log 2>&1 &
```

This keeps monitor.js running after you disconnect. To check it's running:

```bash
ps aux | grep monitor.js
```

To restart it:

```bash
pkill -f monitor.js
nohup node monitor.js >> monitor.log 2>&1 &
```

### 7. Custom domain

In hPanel → Domains → point **strikealert.app** to your Node.js app.
Enable SSL via hPanel → SSL → Let's Encrypt (free).

### 8. Icons

Add your PNG icons to `/public/`:
- `icon-192.png` — 192×192px
- `icon-512.png` — 512×512px

Use any icon editor or generate at https://favicon.io

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port (Hostinger sets this automatically) |

---

## API Endpoints

| Endpoint        | Returns |
|-----------------|---------|
| `GET /api/status`   | Full threat state (state.json) |
| `GET /api/articles` | Last 20 matched articles |
| `GET /api/health`   | `{ status: "ok", uptime: N }` |

---

## Threat Levels

| Level | Label    | Score     | Scan Frequency |
|-------|----------|-----------|----------------|
| 0     | NORMAL   | 0–15      | 30 min         |
| 1     | ELEVATED | 16–40     | 15 min         |
| 2     | HIGH     | 41–80     | 5 min          |
| 3     | CRITICAL | 81+ / T3  | 1 min          |

---

## Sources Monitored

- BBC World News RSS
- New York Times World RSS
- Reuters Political General RSS
- US Department of Defense RSS
- Sky News World RSS
- USGS Earthquake Feed (M2.5+ past hour)

All sources are free and public. No API keys required.

---

## Keyword Scoring

**Tier 3 — Critical (100pts each):** missile launch, nuclear strike, nuclear attack, ballistic missile launched, NORAD activated, nuclear detonation, attack confirmed, emergency broadcast activated, nuclear explosion, missile inbound, launch detected

**Tier 2 — High (40pts each):** nuclear threat, missile test, DEFCON, nuclear armed, warhead, military escalation, nuclear standoff, troops mobilized, air defense activated, nuclear capable, intercontinental ballistic, hypersonic missile

**Tier 1 — Elevated (10pts each):** military tension, nuclear talks, NATO alert, military buildup, geopolitical crisis, nuclear program, missile program, sanctions imposed, military posturing, nuclear negotiations collapsed

---

## Notes

- `state.json` is written atomically (via temp file rename) to prevent corruption.
- If `state.json` is missing or corrupt, the API returns a safe default state.
- The monitor never crashes — all network calls are wrapped in try/catch.
- Feed failures are logged and skipped; remaining feeds continue normally.
- The frontend polls `/api/status` every 60 seconds and auto-plays an alarm if the threat level increases between polls.

---

Built by a solo developer in Albuquerque, NM.
