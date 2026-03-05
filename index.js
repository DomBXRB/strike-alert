/**
 * StrikeAlert — index.js
 * Single entry point for Hostinger deployment.
 *
 * Hostinger routes traffic to whichever process binds process.env.PORT.
 * server.js is required directly (same process, same port binding) so
 * Hostinger's proxy sees it immediately.
 * monitor.js is launched as a child process via spawn() and auto-restarts
 * on crash.
 */

'use strict';

const { spawn } = require('child_process');
const path      = require('path');

// ─── Start monitor as a child process ────────────────────────────────────────

const RESTART_DELAY_MS = 2000;

function startMonitor() {
  const child = spawn(process.execPath, [path.join(__dirname, 'monitor.js')], {
    stdio: 'inherit',
    env:   process.env,
  });

  console.log(`[${new Date().toISOString()}] [monitor] started (pid ${child.pid})`);

  child.on('exit', (code, signal) => {
    console.error(
      `[${new Date().toISOString()}] [monitor] exited ` +
      `(code=${code ?? '—'} signal=${signal ?? '—'}) — restarting in ${RESTART_DELAY_MS}ms`
    );
    setTimeout(startMonitor, RESTART_DELAY_MS);
  });
}

startMonitor();

// ─── Start server in this process (binds PORT for Hostinger) ─────────────────

require('./server.js');
