/**
 * StrikeAlert — monitor.js
 * Continuous RSS feed + USGS seismic scanner.
 * Runs as a separate persistent process alongside server.js.
 * Writes threat state to state.json which the API server reads.
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const Parser   = require('rss-parser');
const fetch    = require('node-fetch');

// ─── Paths ────────────────────────────────────────────────────────────────────
const STATE_FILE   = path.join(__dirname, 'state.json');
const LOG_FILE     = path.join(__dirname, 'monitor.log');

// ─── RSS Feeds ────────────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',                                                              name: 'BBC World'      },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',                                                   name: 'NYT World'      },
  { url: 'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best',                          name: 'Reuters'        },
  { url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=10',                  name: 'DoD'            },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',                                                            name: 'Sky News'       },
];

const USGS_GEOJSON = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson';

// ─── Keyword Tiers ────────────────────────────────────────────────────────────
const TIER3_CRITICAL = [
  'missile launch', 'nuclear strike', 'nuclear attack',
  'ballistic missile launched', 'norad activated',
  'nuclear detonation', 'attack confirmed',
  'emergency broadcast activated', 'nuclear explosion',
  'missile inbound', 'launch detected',
];

const TIER2_HIGH = [
  'nuclear threat', 'missile test', 'defcon',
  'nuclear armed', 'warhead', 'military escalation',
  'nuclear standoff', 'troops mobilized',
  'air defense activated', 'nuclear capable',
  'intercontinental ballistic', 'hypersonic missile',
];

const TIER1_ELEVATED = [
  'military tension', 'nuclear talks', 'nato alert',
  'military buildup', 'geopolitical crisis',
  'nuclear program', 'missile program', 'sanctions imposed',
  'military posturing', 'nuclear negotiations collapsed',
];

// Points per tier
const TIER_POINTS = { 3: 100, 2: 40, 1: 20 };

// ─── Seismic Watch Zones (lat, lon) ───────────────────────────────────────────
const SEISMIC_ZONES = [
  { name: 'Russia/Moscow',  lat: 55.7558, lon: 37.6173 },
  { name: 'North Korea',    lat: 41.3776, lon: 129.7338 },
  { name: 'Iran',           lat: 35.6892, lon: 51.3890  },
  { name: 'China',          lat: 39.9042, lon: 116.4074 },
];
const SEISMIC_RADIUS_KM   = 500;
const SEISMIC_MIN_MAG     = 4.0;
const SEISMIC_MAX_DEPTH   = 10;   // km
const SEISMIC_BONUS_SCORE = 60;

// ─── Threat Level Thresholds ──────────────────────────────────────────────────
const LEVELS = [
  { level: 0, label: 'NORMAL',   min: 0,   max: 15,  freq: 30 },
  { level: 1, label: 'ELEVATED', min: 16,  max: 40,  freq: 15 },
  { level: 2, label: 'HIGH',     min: 41,  max: 80,  freq: 5  },
  { level: 3, label: 'CRITICAL', min: 81,  max: Infinity, freq: 1 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Append a line to monitor.log */
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch (_) { /* non-fatal */ }
}

/** Compute a short hash used as article ID */
function hash(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 12);
}

/**
 * Haversine distance between two lat/lon points in km.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Resolve threat level object from a numeric score.
 * Any Tier 3 keyword match forces Level 3 minimum.
 */
function resolveLevel(score, hasTier3) {
  if (hasTier3 || score >= 81) return LEVELS[3];
  if (score >= 41)             return LEVELS[2];
  if (score >= 16)             return LEVELS[1];
  return LEVELS[0];
}

/**
 * Scan a text string for keywords across all tiers.
 * Returns { matched: [{keyword, tier, points}], totalPoints, hasTier3 }
 */
function scanText(text) {
  const lower    = text.toLowerCase();
  const matched  = [];
  let totalPoints = 0;
  let hasTier3   = false;

  const check = (keywords, tier) => {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        matched.push({ keyword: kw, tier, points: TIER_POINTS[tier] });
        totalPoints += TIER_POINTS[tier];
        if (tier === 3) hasTier3 = true;
      }
    }
  };

  check(TIER3_CRITICAL, 3);
  check(TIER2_HIGH,     2);
  check(TIER1_ELEVATED, 1);

  return { matched, totalPoints, hasTier3 };
}

/** Read and parse state.json, returning a safe default if missing/corrupt */
function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return buildDefaultState();
  }
}

/** Write updated state to state.json atomically via temp file */
function writeState(state) {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

function buildDefaultState() {
  return {
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
    startedAt:      new Date().toISOString(),
  };
}

// ─── RSS Scanning ─────────────────────────────────────────────────────────────

const parser = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'StrikeAlert/1.0 (nuclear-monitoring-pwa)' },
});

/**
 * Fetch and parse one RSS feed.
 * Returns array of article objects that matched at least one keyword.
 */
async function scanFeed(feed) {
  const results = [];
  try {
    const data = await parser.parseURL(feed.url);
    for (const item of (data.items || [])) {
      const combined = `${item.title || ''} ${item.contentSnippet || item.content || item.summary || ''}`;
      const { matched, totalPoints, hasTier3 } = scanText(combined);

      if (matched.length === 0) continue;  // no hits — skip

      // Determine highest tier in this article
      const maxTier = matched.reduce((m, x) => Math.max(m, x.tier), 1);

      results.push({
        id:              hash(item.link || item.title || combined),
        title:           (item.title || '').trim(),
        source:          feed.name,
        url:             item.link || '',
        publishedAt:     item.isoDate || item.pubDate || new Date().toISOString(),
        foundAt:         new Date().toISOString(),
        keywordsMatched: matched.map(m => m.keyword),
        tier:            maxTier,
        points:          totalPoints,
        summary:         combined.slice(0, 200),
      });
    }
  } catch (err) {
    throw new Error(`Feed "${feed.name}" failed: ${err.message}`);
  }
  return results;
}

// ─── USGS Seismic Scanning ────────────────────────────────────────────────────

/**
 * Fetch USGS GeoJSON and return flagged seismic events + bonus score.
 */
async function scanSeismic() {
  const flagged = [];
  let bonus     = 0;

  try {
    const res  = await fetch(USGS_GEOJSON, { timeout: 10000 });
    const data = await res.json();

    for (const feature of (data.features || [])) {
      const props = feature.properties || {};
      const coords = (feature.geometry || {}).coordinates || [];
      const [lon, lat, depth] = coords;
      const mag   = props.mag;

      if (mag === null || mag === undefined) continue;
      if (mag < SEISMIC_MIN_MAG)            continue;
      if ((depth || 999) > SEISMIC_MAX_DEPTH) continue;

      // Check proximity to watch zones
      for (const zone of SEISMIC_ZONES) {
        const dist = haversineKm(lat, lon, zone.lat, zone.lon);
        if (dist <= SEISMIC_RADIUS_KM) {
          const event = {
            id:        hash(`${props.ids || ''}${props.time}`),
            title:     `M${mag.toFixed(1)} earthquake near ${zone.name} — depth ${depth}km`,
            source:    'USGS Seismic',
            url:       props.url || USGS_GEOJSON,
            publishedAt: new Date(props.time).toISOString(),
            foundAt:   new Date().toISOString(),
            keywordsMatched: [`M${mag.toFixed(1)} @ ${dist.toFixed(0)}km from ${zone.name}`],
            tier:      2,
            points:    SEISMIC_BONUS_SCORE,
            summary:   `Magnitude ${mag} seismic event ${dist.toFixed(0)}km from ${zone.name}. Depth: ${depth}km. ${props.place || ''}`,
            isSeismic: true,
          };
          flagged.push(event);
          bonus += SEISMIC_BONUS_SCORE;
          break; // only count each quake once even if near multiple zones
        }
      }
    }
  } catch (err) {
    log(`USGS seismic fetch failed: ${err.message}`);
  }

  return { flagged, bonus };
}

// ─── Main Scan Cycle ──────────────────────────────────────────────────────────

let startTime = Date.now();

async function runScan() {
  log('--- Scan cycle starting ---');

  const prevState     = readState();
  const existingUrls  = new Set((prevState.articles || []).map(a => a.url));

  let totalScore   = 0;
  let hasTier3     = false;
  let newArticles  = [];
  let sourcesFailed = 0;

  // Scan all RSS feeds in parallel
  const feedResults = await Promise.allSettled(RSS_FEEDS.map(f => scanFeed(f)));

  for (let i = 0; i < feedResults.length; i++) {
    const result = feedResults[i];
    if (result.status === 'fulfilled') {
      for (const article of result.value) {
        // Deduplicate by URL
        if (existingUrls.has(article.url)) continue;
        existingUrls.add(article.url);
        newArticles.push(article);
        totalScore += article.points;
        if (article.tier === 3) hasTier3 = true;
      }
    } else {
      sourcesFailed++;
      log(`Feed error: ${result.reason.message}`);
    }
  }

  // Scan seismic data
  const { flagged: seismicEvents, bonus: seismicBonus } = await scanSeismic();
  totalScore += seismicBonus;
  if (seismicBonus > 0) {
    log(`Seismic bonus: +${seismicBonus} points from ${seismicEvents.length} flagged event(s)`);
    newArticles = newArticles.concat(seismicEvents);
  }

  // Merge with existing articles (keep last 20, newest first)
  const merged = [...newArticles, ...(prevState.articles || [])]
    .filter((a, idx, arr) => arr.findIndex(b => b.url === a.url) === idx) // dedupe
    .sort((a, b) => new Date(b.foundAt) - new Date(a.foundAt))
    .slice(0, 20);

  // Resolve threat level
  const levelObj       = resolveLevel(totalScore, hasTier3);
  const previousLevel  = prevState.level || 0;
  const levelChangedAt =
    levelObj.level !== previousLevel
      ? new Date().toISOString()
      : (prevState.levelChangedAt || null);

  const now      = new Date();
  const nextCheck = new Date(now.getTime() + levelObj.freq * 60 * 1000);
  const uptimeHrs = ((Date.now() - startTime) / 3600000).toFixed(2);

  const newState = {
    level:          levelObj.level,
    label:          levelObj.label,
    score:          totalScore,
    previousLevel,
    levelChangedAt,
    checkFrequency: levelObj.freq,
    lastChecked:    now.toISOString(),
    nextCheck:      nextCheck.toISOString(),
    sourcesChecked: RSS_FEEDS.length + 1,    // +1 for USGS
    sourcesFailed,
    articles:       merged,
    seismicEvents,
    uptime:         parseFloat(uptimeHrs),
    startedAt:      prevState.startedAt || now.toISOString(),
  };

  writeState(newState);

  log(
    `Scan complete — Level ${levelObj.level} (${levelObj.label}) | ` +
    `Score: ${totalScore} | New articles: ${newArticles.length} | ` +
    `Failed sources: ${sourcesFailed} | Next check in ${levelObj.freq}min`
  );

  // Schedule next scan based on current threat level
  setTimeout(runScan, levelObj.freq * 60 * 1000);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

log('StrikeAlert monitor starting…');

// Write an initial default state if none exists
if (!fs.existsSync(STATE_FILE)) {
  writeState(buildDefaultState());
  log('Initialized state.json with defaults');
}

// Kick off the first scan immediately
runScan().catch(err => {
  log(`Unhandled error in runScan: ${err.message}`);
  // Retry after 5 minutes on catastrophic failure
  setTimeout(runScan, 5 * 60 * 1000);
});
