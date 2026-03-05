/**
 * StrikeAlert — server.js
 * Express API server. Serves static frontend from /public and exposes
 * JSON API endpoints that the React app polls.
 *
 * Start with: node server.js
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app        = express();
const PORT       = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'state.json');
const START_TIME = Date.now();

// ─── Safe Default State ───────────────────────────────────────────────────────
// Returned if state.json is missing or malformed
const DEFAULT_STATE = {
  level:          0,
  label:          'NORMAL',
  score:          0,
  previousLevel:  0,
  levelChangedAt: null,
  checkFrequency: 30,
  lastChecked:    null,
  nextCheck:      null,
  sourcesChecked: 0,
  sourcesFailed:  0,
  articles:       [],
  seismicEvents:  [],
  uptime:         0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read state.json safely; never throws */
function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    // Basic sanity check
    if (typeof parsed.level !== 'number') return DEFAULT_STATE;
    return parsed;
  } catch (_) {
    return DEFAULT_STATE;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// Enable CORS for all origins (required for PWA + potential CDN use)
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options',  'nosniff');
  res.setHeader('X-Frame-Options',         'DENY');
  res.setHeader('X-XSS-Protection',        '1; mode=block');
  res.setHeader('Referrer-Policy',         'strict-origin-when-cross-origin');
  // Allow service worker to function from root scope
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; worker-src 'self';"
  );
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/status
 * Returns the full current threat state.
 */
app.get('/api/status', (req, res) => {
  const state = readState();
  res.json(state);
});

/**
 * GET /api/articles
 * Returns only the articles array (last 20).
 */
app.get('/api/articles', (req, res) => {
  const state = readState();
  res.json(state.articles || []);
});

/**
 * GET /api/health
 * Simple health check endpoint for uptime monitors and Hostinger.
 */
app.get('/api/health', (req, res) => {
  const uptimeSec = Math.floor((Date.now() - START_TIME) / 1000);
  res.json({
    status:  'ok',
    uptime:  uptimeSec,
    version: '1.0.0',
  });
});

// ─── Static Frontend ──────────────────────────────────────────────────────────

// Serve everything in /public as static files
app.use(express.static(path.join(__dirname, 'public'), {
  // Allow service worker to be served with correct headers
  setHeaders(res, filePath) {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  },
}));

// SPA fallback — any non-API, non-asset path returns index.html
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(503).json({ error: 'Frontend not found. Place index.html in /public.' });
  }
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] StrikeAlert server running on port ${PORT}`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → API: http://localhost:${PORT}/api/status`);
});
