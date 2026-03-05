/**
 * StrikeAlert — Service Worker (sw.js)
 * Handles: offline caching, background sync, push notifications.
 */

'use strict';

const CACHE_NAME    = 'strikealert-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.jsx',
  '/manifest.json',
];

// ─── Install ──────────────────────────────────────────────────────────────────
// Pre-cache the app shell on install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        // Non-fatal — continue even if some assets can't be cached
        console.warn('[SW] Failed to pre-cache some assets:', err);
      });
    })
  );
  self.skipWaiting(); // Activate immediately
});

// ─── Activate ─────────────────────────────────────────────────────────────────
// Remove old caches on activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // Take control of all pages immediately
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
// Network-first for API calls; cache-first for static assets
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    // API calls: network first, no cache fallback (fresh data is critical)
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline — no live data available' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
  } else {
    // Static assets: cache first, fallback to network
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          // Cache successful responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          // Offline fallback for navigation requests
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
    );
  }
});

// ─── Push Notifications ───────────────────────────────────────────────────────
// Fired when a push message arrives from the server
self.addEventListener('push', event => {
  let data = { level: 0, label: 'NORMAL', title: '' };
  try {
    data = event.data ? event.data.json() : data;
  } catch (_) {}

  // Only notify if threat level is elevated
  if (data.level < 2) return;

  const options = {
    body:    `${data.label} — ${data.title || 'Threat indicators rising. Check StrikeAlert.'}`,
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
    tag:     'threat-alert',           // Replace previous notification
    renotify: true,
    vibrate: [300, 100, 300, 100, 600],
    data:    { url: '/' },
    actions: [
      { action: 'open',    title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss'  },
    ],
  };

  event.waitUntil(
    self.registration.showNotification('⚠ StrikeAlert — Threat Level Rising', options)
  );
});

// ─── Notification Click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing window if open
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// ─── Background Sync ──────────────────────────────────────────────────────────
// Fires when connectivity is restored after being offline
self.addEventListener('sync', event => {
  if (event.tag === 'threat-check') {
    event.waitUntil(
      // Notify all open clients to refresh their data
      clients.matchAll({ type: 'window' }).then(clientList => {
        for (const client of clientList) {
          client.postMessage({ type: 'SYNC_COMPLETE' });
        }
      })
    );
  }
});
