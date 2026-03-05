/**
 * StrikeAlert — index.js
 * Single entry point for Hostinger deployment.
 * Forks server.js and monitor.js as child processes and
 * automatically restarts either one if it crashes.
 */

'use strict';

const { fork } = require('child_process');
const path     = require('path');

const PROCESSES = [
  { name: 'server',  file: 'server.js'  },
  { name: 'monitor', file: 'monitor.js' },
];

// Minimum ms between restarts — prevents tight crash loops
const RESTART_DELAY_MS = 2000;

function spawn(entry) {
  const child = fork(path.join(__dirname, entry.file), [], {
    stdio: 'inherit', // pipe child stdout/stderr to this process
  });

  console.log(`[${new Date().toISOString()}] [${entry.name}] started (pid ${child.pid})`);

  child.on('exit', (code, signal) => {
    console.error(
      `[${new Date().toISOString()}] [${entry.name}] exited ` +
      `(code=${code ?? '—'} signal=${signal ?? '—'}) — restarting in ${RESTART_DELAY_MS}ms`
    );
    setTimeout(() => spawn(entry), RESTART_DELAY_MS);
  });
}

PROCESSES.forEach(spawn);
