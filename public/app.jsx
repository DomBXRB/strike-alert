/**
 * StrikeAlert — app.jsx
 * Full React PWA frontend. No build step required.
 * Loaded via Babel standalone in index.html.
 */

/* global React, ReactDOM */

'use strict';

const { useState, useEffect, useRef, useCallback } = React;

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // 60 seconds

const LEVEL_CONFIG = {
  0: { label: 'NORMAL',   color: '#00ff88', bg: 'rgba(0,255,136,0.08)'  },
  1: { label: 'ELEVATED', color: '#ffcc00', bg: 'rgba(255,204,0,0.08)'  },
  2: { label: 'HIGH',     color: '#ff6600', bg: 'rgba(255,102,0,0.08)'  },
  3: { label: 'CRITICAL', color: '#ff0000', bg: 'rgba(255,0,0,0.08)'    },
};

const TABS = ['DASHBOARD', 'ALERTS', 'SURVIVE', 'ABOUT', 'SETTINGS'];

// ─── Audio Alarm (Web Audio API) ──────────────────────────────────────────────

function playAlarm() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);

    // Two oscillators sweep for urgency
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.connect(gain);
      const start = ctx.currentTime + i * 0.7;
      osc.frequency.setValueAtTime(880, start);
      osc.frequency.linearRampToValueAtTime(440, start + 0.5);
      osc.start(start);
      osc.stop(start + 0.65);
    }

    // Fade out gain after alarm
    gain.gain.setValueAtTime(0.4, ctx.currentTime + 1.8);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2.1);
  } catch (err) {
    console.warn('Audio alarm failed:', err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const min  = Math.floor(diff / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function countdown(isoString) {
  if (!isoString) return '—';
  const diff = Math.max(0, new Date(isoString).getTime() - Date.now());
  const min  = Math.floor(diff / 60000);
  const sec  = Math.floor((diff % 60000) / 1000);
  return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function tierBorderColor(tier) {
  return { 3: '#ff0000', 2: '#ff6600', 1: '#ffcc00', 0: '#00ff88' }[tier] || '#444';
}

// ─── Global Styles (injected once) ───────────────────────────────────────────

function injectStyles(accent) {
  const id = 'sa-dynamic-styles';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('style');
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = `
    :root { --accent: ${accent}; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: #0f0f0f; }
    ::-webkit-scrollbar-thumb { background: ${accent}44; border-radius: 2px; }

    /* Tabs */
    .tab-btn {
      background: none; border: none; cursor: pointer;
      font-family: 'Courier New', monospace;
      font-size: 0.7rem; letter-spacing: 0.1em;
      padding: 10px 14px; color: #555;
      border-bottom: 2px solid transparent;
      transition: color 0.2s, border-color 0.2s;
      white-space: nowrap;
    }
    .tab-btn:hover  { color: ${accent}; }
    .tab-btn.active { color: ${accent}; border-bottom-color: ${accent}; }

    /* Cards */
    .article-card {
      background: #0f0f0f; border-radius: 4px;
      padding: 14px 14px 14px 18px;
      margin-bottom: 10px;
      border-left: 3px solid var(--tier-color, #444);
      cursor: pointer; transition: background 0.15s;
    }
    .article-card:hover { background: #161616; }

    /* Keyword chips */
    .chip {
      display: inline-block; font-size: 0.62rem;
      padding: 2px 7px; border-radius: 2px;
      margin: 2px 3px 2px 0;
      background: ${accent}22; color: ${accent};
      border: 1px solid ${accent}44; letter-spacing: 0.05em;
    }
    .chip.tier-3 { background: #ff000022; color: #ff4444; border-color: #ff000044; }
    .chip.tier-2 { background: #ff660022; color: #ff8844; border-color: #ff660044; }
    .chip.tier-1 { background: #ffcc0022; color: #ffdd44; border-color: #ffcc0044; }

    /* Toggle switch */
    .toggle {
      position: relative; display: inline-block;
      width: 44px; height: 24px;
    }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .toggle-slider {
      position: absolute; inset: 0; cursor: pointer;
      background: #222; border-radius: 24px;
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: ''; position: absolute;
      width: 18px; height: 18px; left: 3px; bottom: 3px;
      background: #555; border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }
    .toggle input:checked + .toggle-slider { background: ${accent}33; }
    .toggle input:checked + .toggle-slider::before {
      transform: translateX(20px); background: ${accent};
    }

    /* Threat bar */
    .threat-bar-fill {
      height: 100%; border-radius: 2px;
      background: ${accent};
      transition: width 0.8s ease, background 0.5s ease;
    }

    /* Level badge */
    .level-badge {
      font-size: 3.5rem; font-weight: bold;
      letter-spacing: 0.06em;
      color: ${accent};
      text-shadow: 0 0 30px ${accent}66;
      transition: color 0.5s, text-shadow 0.5s;
    }

    /* Survive step cards */
    .step-card {
      display: flex; gap: 14px; align-items: flex-start;
      background: #0f0f0f; border-radius: 4px;
      padding: 14px; margin-bottom: 8px;
      border-left: 3px solid ${accent}55;
    }
    .step-time {
      font-size: 0.75rem; color: ${accent};
      min-width: 52px; padding-top: 2px; letter-spacing: 0.05em;
    }
    .step-text { font-size: 0.82rem; line-height: 1.6; color: #ccc; }

    /* Section headers */
    .section-title {
      font-size: 0.7rem; letter-spacing: 0.2em;
      color: ${accent}; border-bottom: 1px solid ${accent}33;
      padding-bottom: 6px; margin-bottom: 14px; margin-top: 24px;
    }

    /* Distance table */
    .distance-table {
      width: 100%; border-collapse: collapse;
      font-size: 0.78rem; margin-top: 8px;
    }
    .distance-table th {
      text-align: left; padding: 8px 10px;
      color: ${accent}; border-bottom: 1px solid #222;
      font-weight: normal; letter-spacing: 0.1em;
    }
    .distance-table td {
      padding: 8px 10px; border-bottom: 1px solid #111;
      color: #bbb; vertical-align: top;
    }
    .distance-table tr:hover td { background: #0f0f0f; }

    /* Live dot */
    @keyframes live-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.5; transform: scale(1.3); }
    }
    .live-dot {
      display: inline-block; width: 7px; height: 7px;
      border-radius: 50%; background: ${accent};
      animation: live-pulse 1.5s ease-in-out infinite;
      margin-right: 5px;
    }
  `;
}

// ─── Screen Flash Overlay ─────────────────────────────────────────────────────

function ScreenFlash({ trigger }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!trigger) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1300);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!visible) return null;
  return <div className="screen-flash" />;
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({ level, activeTab, onTabChange }) {
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG[0];
  return (
    <header style={{
      borderBottom: `1px solid #1a1a1a`,
      background: '#090909',
      position: 'sticky', top: 0, zIndex: 100,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 16px',
        maxWidth: 700, margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: '0.95rem', fontWeight: 'bold',
            color: cfg.color, letterSpacing: '0.1em',
          }}>
            &#9888; STRIKEALERT
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.7rem' }}>
          <span className="live-dot" />
          <span style={{ color: cfg.color, letterSpacing: '0.08em' }}>
            {cfg.label}
          </span>
        </div>
      </div>
      {/* Tabs */}
      <div style={{
        display: 'flex', overflowX: 'auto',
        borderTop: '1px solid #111',
        maxWidth: 700, margin: '0 auto',
      }}>
        {TABS.map(tab => (
          <button
            key={tab}
            className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => onTabChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
    </header>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────

function DashboardTab({ status }) {
  const [tick, setTick] = useState(0);
  const level = status?.level ?? 0;
  const cfg   = LEVEL_CONFIG[level] || LEVEL_CONFIG[0];

  // Countdown timer re-renders every second
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const barWidth = `${(level / 3) * 100}%`;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 700, margin: '0 auto' }}>

      {/* Main threat level display */}
      <div style={{
        textAlign: 'center', padding: '32px 20px',
        background: cfg.bg, border: `1px solid ${cfg.color}33`,
        borderRadius: 6, marginBottom: 20,
      }}>
        <div style={{ fontSize: '0.65rem', color: '#555', letterSpacing: '0.25em', marginBottom: 8 }}>
          CURRENT THREAT LEVEL
        </div>

        {/* Pulsing dot for level 2+ */}
        <div style={{ marginBottom: 10 }}>
          <span
            className={level >= 2 ? 'pulse' : ''}
            style={{
              display: 'inline-block',
              width: 12, height: 12,
              borderRadius: '50%',
              background: cfg.color,
              boxShadow: `0 0 12px ${cfg.color}`,
            }}
          />
        </div>

        <div className="level-badge" style={{ color: cfg.color, textShadow: `0 0 30px ${cfg.color}66` }}>
          {level}
        </div>
        <div style={{
          fontSize: '1.1rem', letterSpacing: '0.3em',
          color: cfg.color, margin: '6px 0 20px',
        }}>
          {cfg.label}
        </div>

        {/* Threat bar */}
        <div style={{
          height: 6, background: '#111', borderRadius: 3,
          overflow: 'hidden', maxWidth: 340, margin: '0 auto',
        }}>
          <div
            className="threat-bar-fill"
            style={{ width: barWidth, background: cfg.color }}
          />
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          maxWidth: 340, margin: '4px auto 0',
          fontSize: '0.6rem', color: '#333', letterSpacing: '0.08em',
        }}>
          <span>NORMAL</span><span>ELEVATED</span><span>HIGH</span><span>CRITICAL</span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 10, marginBottom: 20,
      }}>
        {[
          { label: 'THREAT SCORE',   value: status?.score ?? 0 },
          { label: 'SOURCES LIVE',   value: status?.sourcesChecked ?? 0 },
          { label: 'LAST CHECKED',   value: timeAgo(status?.lastChecked) },
          { label: 'NEXT CHECK',     value: countdown(status?.nextCheck) },
          { label: 'CHECK FREQ',     value: `${status?.checkFrequency ?? 30}min` },
          { label: 'MONITOR UPTIME', value: `${status?.uptime ?? 0}h` },
        ].map(({ label, value }) => (
          <div key={label} style={{
            background: '#0f0f0f', border: '1px solid #1a1a1a',
            borderRadius: 4, padding: '12px 14px',
          }}>
            <div style={{ fontSize: '0.58rem', color: '#444', letterSpacing: '0.18em', marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: '0.95rem', color: cfg.color, letterSpacing: '0.05em' }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Level explanation */}
      <div style={{
        background: '#0a0a0a', border: '1px solid #1a1a1a',
        borderRadius: 4, padding: '14px',
        fontSize: '0.75rem', color: '#555', lineHeight: 1.7,
      }}>
        <div style={{ color: '#333', letterSpacing: '0.15em', fontSize: '0.6rem', marginBottom: 8 }}>
          ABOUT THIS READING
        </div>
        {level === 0 && 'No significant threat indicators detected across monitored sources. Conditions are currently normal. StrikeAlert continues to scan every 30 minutes.'}
        {level === 1 && 'Low-level threat indicators detected. Elevated language present in monitored news sources. Check the ALERTS tab for details. Scanning every 15 minutes.'}
        {level === 2 && 'Significant threat indicators active. Multiple high-priority keywords detected. Review ALERTS immediately and stay near the app. Scanning every 5 minutes.'}
        {level === 3 && '⚠ CRITICAL — Extreme threat language or Tier 3 keywords detected. Review ALERTS and SURVIVE tabs immediately. Scanning every 60 seconds.'}
      </div>
    </div>
  );
}

// ─── Alerts Tab ───────────────────────────────────────────────────────────────

function AlertsTab({ articles, level }) {
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG[0];

  if (!articles || articles.length === 0) {
    return (
      <div style={{ padding: '60px 16px', textAlign: 'center', color: '#333' }}>
        <div style={{ fontSize: '2rem', marginBottom: 12 }}>&#10003;</div>
        <div style={{ fontSize: '0.8rem', letterSpacing: '0.12em' }}>NO ELEVATED ALERTS</div>
        <div style={{ fontSize: '0.7rem', color: '#222', marginTop: 6 }}>
          All monitored sources are clear
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', maxWidth: 700, margin: '0 auto' }}>
      <div style={{
        fontSize: '0.62rem', color: '#444', letterSpacing: '0.15em',
        marginBottom: 14,
      }}>
        {articles.length} ALERT{articles.length !== 1 ? 'S' : ''} — NEWEST FIRST
      </div>

      {articles.map(article => (
        <div
          key={article.id}
          className="article-card"
          style={{ '--tier-color': tierBorderColor(article.tier) }}
          onClick={() => article.url && window.open(article.url, '_blank', 'noopener')}
        >
          {/* Source + time */}
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 6,
          }}>
            <span style={{ fontSize: '0.65rem', color: '#555', letterSpacing: '0.1em' }}>
              {article.isSeismic ? '🌍 ' : ''}{article.source}
            </span>
            <span style={{ fontSize: '0.62rem', color: '#333' }}>
              {timeAgo(article.publishedAt)}
            </span>
          </div>

          {/* Headline */}
          <div style={{
            fontSize: '0.83rem', color: '#ddd',
            lineHeight: 1.4, marginBottom: 8,
          }}>
            {article.title}
          </div>

          {/* Summary */}
          {article.summary && (
            <div style={{
              fontSize: '0.72rem', color: '#555',
              lineHeight: 1.5, marginBottom: 8,
            }}>
              {article.summary.slice(0, 160)}{article.summary.length > 160 ? '…' : ''}
            </div>
          )}

          {/* Keyword chips */}
          <div style={{ marginBottom: 6 }}>
            {(article.keywordsMatched || []).map((kw, i) => (
              <span key={i} className={`chip tier-${article.tier}`}>
                {kw}
              </span>
            ))}
          </div>

          {/* Points badge */}
          <div style={{ fontSize: '0.6rem', color: '#333' }}>
            +{article.points} pts &nbsp;·&nbsp; Tier {article.tier}
            {article.url && <span style={{ color: '#222' }}> &nbsp;·&nbsp; click to open ↗</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Survive Tab ──────────────────────────────────────────────────────────────

function SurviveTab() {
  const STEPS = [
    { time: '0s',       text: 'See the flash. Abnormally intense light — brighter than anything natural. Do NOT look at it. Avert your eyes immediately.' },
    { time: '0–8s',     text: 'Drop immediately. Get below window level. Move toward an interior room NOW. Every second counts — do not stop to gather belongings.' },
    { time: '8s',       text: 'Reach a bathroom or hallway. Any interior room with no exterior windows is your target. Bathrooms offer a tub for additional cover.' },
    { time: '8–18s',    text: 'Get in the tub or crouch low against an interior wall. Face down, hands covering the back of your neck and head. Stay as low as possible.' },
    { time: '~18–20s',  text: 'Shockwave hits. Violent shaking, a massive pressure wave, possible structural movement. Stay covered. Do not move until it passes.' },
    { time: '20s+',     text: 'Stay sheltered. Do NOT go outside. Do NOT look out windows. Fallout begins arriving within 15–30 minutes of the detonation.' },
    { time: '15–30min', text: 'Fallout arrives. Wet a cloth — any liquid, any fabric. An energy drink on a sweater works. Slightly damp is better than soaking wet. Cover your nose and mouth.' },
    { time: '24–48hrs', text: 'Remain inside. The most dangerous short-lived radioactive isotopes decay rapidly in the first 24 hours. Staying inside dramatically reduces your total exposure.' },
  ];

  const DISTANCE_TABLE = [
    { dist: '0–0.5 mi',  zone: 'Fireball',          survival: 'None',      note: 'Vaporization zone' },
    { dist: '0.5–1 mi',  zone: 'Severe blast',       survival: 'Very low',  note: 'Total structural collapse' },
    { dist: '1–3 mi',    zone: 'Heavy damage',       survival: 'Low',       note: 'Severe burns, debris' },
    { dist: '3–5 mi',    zone: 'Moderate damage',    survival: 'Moderate',  note: '~18–20s warning window' },
    { dist: '5–10 mi',   zone: 'Light damage',       survival: 'High',      note: 'Shelter-in-place effective' },
    { dist: '10+ mi',    zone: 'Fallout risk only',  survival: 'Very high', note: 'Shelter + filter critical' },
  ];

  return (
    <div style={{ padding: '16px', maxWidth: 700, margin: '0 auto' }}>

      {/* Hero warning */}
      <div style={{
        background: '#0f0f0f', border: '1px solid #ff000033',
        borderRadius: 4, padding: '16px', marginBottom: 20,
        borderLeft: '3px solid #ff4444',
      }}>
        <div style={{ fontSize: '0.65rem', color: '#ff4444', letterSpacing: '0.2em', marginBottom: 6 }}>
          READ THIS NOW — NOT WHEN IT HAPPENS
        </div>
        <div style={{ fontSize: '0.8rem', color: '#ccc', lineHeight: 1.7 }}>
          If you live near a military installation, major city, or nuclear facility — you have seconds, not minutes.
          The information below is based on established nuclear survival research. Knowing it in advance is the difference.
        </div>
      </div>

      {/* Flash → Action sequence */}
      <div className="section-title">FLASH → ACTION SEQUENCE</div>
      {STEPS.map((step, i) => (
        <div key={i} className="step-card">
          <div className="step-time">{step.time}</div>
          <div className="step-text">{step.text}</div>
        </div>
      ))}

      {/* Why 18 seconds */}
      <div className="section-title">WHY YOU HAVE 18 SECONDS</div>
      <div style={{
        background: '#0f0f0f', borderRadius: 4, padding: '16px',
        fontSize: '0.8rem', color: '#bbb', lineHeight: 1.8, marginBottom: 10,
      }}>
        <p>The shockwave from a nuclear detonation travels at approximately <strong style={{color:'#fff'}}>1,100 feet per second</strong> — roughly the speed of sound.</p>
        <br />
        <p>At 4 miles from the detonation point, you have <strong style={{color:'#ff6600'}}>roughly 18–20 seconds</strong> between the flash and shockwave impact. At 2 miles, that drops to 9 seconds. At 6 miles, you have nearly 30 seconds.</p>
        <br />
        <p>The thermal pulse (the flash) travels at the <strong style={{color:'#fff'}}>speed of light</strong>. It arrives essentially instantaneously. That flash is your only warning. There is no siren, no announcement — just light.</p>
        <br />
        <p>The window exists because physics. Use it.</p>
      </div>

      {/* Improvised filter */}
      <div className="section-title">IMPROVISED FALLOUT FILTER</div>
      <div style={{
        background: '#0f0f0f', borderRadius: 4, padding: '16px',
        fontSize: '0.8rem', color: '#bbb', lineHeight: 1.8, marginBottom: 10,
      }}>
        <p><strong style={{color:'#fff'}}>Any cloth + any liquid = a fallout particle filter.</strong></p>
        <br />
        <p>Fallout is radioactive dust — physical particles. The immediate danger is inhaling or ingesting these particles, causing internal contamination. A wet cloth over your nose and mouth physically blocks most particles from reaching your lungs.</p>
        <br />
        <p><strong style={{color:'#ffcc00'}}>What works:</strong> T-shirt, sock, bandana, paper towel — moistened with water, juice, soda, anything available. Slightly damp works better than soaking wet (soaking can reduce airflow and filtration).</p>
        <br />
        <p>This does not stop gamma radiation penetrating your body from outside. But it prevents internal contamination — your biggest controllable post-blast survival variable.</p>
      </div>

      {/* Distance table */}
      <div className="section-title">DISTANCE SURVIVAL ZONES (STANDARD WARHEAD)</div>
      <table className="distance-table">
        <thead>
          <tr>
            <th>Distance</th>
            <th>Zone</th>
            <th>Survival</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {DISTANCE_TABLE.map((row, i) => (
            <tr key={i}>
              <td style={{color:'#fff'}}>{row.dist}</td>
              <td>{row.zone}</td>
              <td style={{color: row.survival === 'None' ? '#ff4444' : row.survival === 'Very low' ? '#ff6600' : row.survival === 'Low' ? '#ffcc00' : '#00ff88'}}>{row.survival}</td>
              <td>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{
        marginTop: 16, fontSize: '0.65rem', color: '#333', lineHeight: 1.6,
      }}>
        Distances are approximate for a 300kt warhead detonated at optimal burst height. Actual effects vary significantly based on yield, burst height, terrain, building construction, and weather. These figures are for general preparedness reference only.
      </div>
    </div>
  );
}

// ─── About Tab ────────────────────────────────────────────────────────────────

function AboutTab() {
  return (
    <div style={{ padding: '16px', maxWidth: 700, margin: '0 auto' }}>
      <div style={{
        fontSize: '1rem', fontWeight: 'bold',
        color: '#fff', letterSpacing: '0.05em',
        marginBottom: 20, lineHeight: 1.4,
      }}>
        Why I Built StrikeAlert
      </div>

      <div style={{
        fontSize: '0.82rem', color: '#bbb', lineHeight: 1.85,
      }}>
        <p>
          I'm 18 years old and I live in Albuquerque, New Mexico — <strong style={{color:'#fff'}}>4 miles from Kirtland Air Force Base</strong>. Most people don't know that Kirtland holds nearly half of America's entire nuclear arsenal. Around 2,500 warheads are stored underground just miles from a major US city.
        </p>

        <br />

        <p>
          I started wondering what would actually happen if a strike occurred. I researched blast radii, thermal pulses, shockwave timing, fallout survival. I learned that at my distance I would have <strong style={{color:'#ff6600'}}>roughly 18 seconds</strong> between seeing the flash and the shockwave hitting my building. I learned exactly where to go, what to do, and why a wet cloth matters.
        </p>

        <br />

        <p>
          Then I realized — <strong style={{color:'#fff'}}>there's no app that gives regular people early warning AND tells them what to actually do</strong>. Government alerts fire after decisions have already been made. By then it may be too late to act.
        </p>

        <br />

        <p>
          I build web tools and digital products online. So I built StrikeAlert — because the gap between "scared" and "prepared" is just information.
        </p>

        <br />

        <p>
          StrikeAlert monitors live news feeds, government sources, and USGS seismic data continuously. The moment indicators rise, you know before the official alert fires.
        </p>
      </div>

      <div style={{
        marginTop: 32, paddingTop: 20,
        borderTop: '1px solid #1a1a1a',
        fontSize: '0.72rem', color: '#444',
      }}>
        <div style={{ marginBottom: 6 }}>Built by a solo developer in Albuquerque, NM.</div>
        <div>Other tools at <span style={{color:'#555'}}>[your other sites — add link here]</span></div>
      </div>

      {/* Tech stack */}
      <div style={{
        marginTop: 28, background: '#0a0a0a',
        border: '1px solid #1a1a1a', borderRadius: 4, padding: 16,
      }}>
        <div style={{ fontSize: '0.6rem', color: '#333', letterSpacing: '0.2em', marginBottom: 12 }}>
          HOW IT WORKS
        </div>
        {[
          ['Sources', 'BBC, NYT, Reuters, DoD, Sky News, USGS Seismic'],
          ['Scoring',  'Keyword tier system — 10 / 40 / 100 pts per match'],
          ['Seismic',  'M4.0+ shallow events near 4 geopolitical zones'],
          ['Hosting',  'Node.js on Hostinger — strikealert.app'],
          ['Frontend', 'React PWA — installable, works offline'],
        ].map(([k, v]) => (
          <div key={k} style={{
            display: 'flex', gap: 12, marginBottom: 8,
            fontSize: '0.75rem',
          }}>
            <span style={{ color: '#555', minWidth: 60 }}>{k}</span>
            <span style={{ color: '#888' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ settings, onSettingsChange, level, checkFrequency, onTestAlarm }) {
  const cfg = LEVEL_CONFIG[level] || LEVEL_CONFIG[0];

  return (
    <div style={{ padding: '16px', maxWidth: 700, margin: '0 auto' }}>

      {/* Alert preferences */}
      <div className="section-title" style={{ marginTop: 0 }}>ALERT PREFERENCES</div>

      {[
        {
          key:   'audioEnabled',
          label: 'Audio alarm',
          desc:  'Play alarm sound when threat level increases',
        },
        {
          key:   'notifyOnIncrease',
          label: 'Notify on level increase',
          desc:  'Show browser notification when threat rises',
        },
      ].map(({ key, label, desc }) => (
        <div key={key} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#0f0f0f', border: '1px solid #1a1a1a',
          borderRadius: 4, padding: '14px', marginBottom: 8,
        }}>
          <div>
            <div style={{ fontSize: '0.8rem', color: '#ccc', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: '0.68rem', color: '#444' }}>{desc}</div>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings[key] || false}
              onChange={e => onSettingsChange(key, e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      ))}

      {/* Test alarm button */}
      <button
        onClick={onTestAlarm}
        style={{
          width: '100%', padding: '11px', marginTop: 4, marginBottom: 20,
          background: 'none', border: `1px solid ${cfg.color}44`,
          color: cfg.color, fontFamily: 'Courier New, monospace',
          fontSize: '0.75rem', letterSpacing: '0.15em',
          cursor: 'pointer', borderRadius: 4,
          transition: 'background 0.15s',
        }}
        onMouseOver={e => e.currentTarget.style.background = `${cfg.color}11`}
        onMouseOut={e  => e.currentTarget.style.background = 'none'}
      >
        &#9654; TEST ALARM SOUND
      </button>

      {/* System info */}
      <div className="section-title">MONITOR STATUS</div>
      <div style={{
        background: '#0f0f0f', border: '1px solid #1a1a1a',
        borderRadius: 4, padding: '14px', marginBottom: 20,
      }}>
        {[
          ['Current check frequency', `Every ${checkFrequency} minutes (auto-adjusted)`],
          ['Poll interval',           'Frontend refreshes every 60 seconds'],
          ['Sources monitored',       'BBC, NYT, Reuters, DoD, Sky News, USGS'],
        ].map(([k, v]) => (
          <div key={k} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '6px 0', borderBottom: '1px solid #111',
            fontSize: '0.75rem',
          }}>
            <span style={{ color: '#555' }}>{k}</span>
            <span style={{ color: '#888' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Threshold explanation */}
      <div className="section-title">THREAT LEVEL THRESHOLDS</div>
      <div style={{ marginBottom: 20 }}>
        {[
          { lvl: 0, label: 'NORMAL',   range: '0–15 pts',  freq: '30min', color: '#00ff88' },
          { lvl: 1, label: 'ELEVATED', range: '16–40 pts', freq: '15min', color: '#ffcc00' },
          { lvl: 2, label: 'HIGH',     range: '41–80 pts', freq: '5min',  color: '#ff6600' },
          { lvl: 3, label: 'CRITICAL', range: '81+ pts',   freq: '1min',  color: '#ff0000' },
        ].map(row => (
          <div key={row.lvl} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px', marginBottom: 6,
            background: '#0f0f0f', borderRadius: 4,
            border: '1px solid #1a1a1a',
          }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8,
              borderRadius: '50%', background: row.color, flexShrink: 0,
            }} />
            <span style={{ color: row.color, fontSize: '0.75rem', minWidth: 68 }}>{row.label}</span>
            <span style={{ color: '#555', fontSize: '0.72rem', flex: 1 }}>{row.range}</span>
            <span style={{ color: '#333', fontSize: '0.68rem' }}>scan/{row.freq}</span>
          </div>
        ))}
      </div>

      {/* Pro upgrade section */}
      <div style={{
        background: '#0a0a0a',
        border: '1px solid #333',
        borderRadius: 6, padding: '20px 16px',
        textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-block', padding: '3px 10px',
          border: '1px solid #555', borderRadius: 2,
          fontSize: '0.6rem', color: '#555', letterSpacing: '0.2em',
          marginBottom: 12,
        }}>
          COMING SOON
        </div>
        <div style={{ fontSize: '0.95rem', color: '#ccc', marginBottom: 6 }}>
          StrikeAlert Pro
        </div>
        <div style={{ fontSize: '1.2rem', color: '#fff', marginBottom: 16, fontWeight: 'bold' }}>
          $2.99 / month
        </div>
        {[
          'Priority government & SIGINT sources',
          'SMS alerts to your phone',
          'Family sharing — up to 5 people',
          'Historical threat data & trends',
        ].map((f, i) => (
          <div key={i} style={{
            fontSize: '0.75rem', color: '#555',
            padding: '5px 0', borderBottom: '1px solid #111',
          }}>
            {f}
          </div>
        ))}
        <div style={{
          marginTop: 16, fontSize: '0.68rem', color: '#333',
        }}>
          Join the waitlist — launch announcement coming soon
        </div>
      </div>
    </div>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────

function App() {
  const [activeTab,   setActiveTab]   = useState('DASHBOARD');
  const [status,      setStatus]      = useState(null);
  const [flashTrigger, setFlashTrigger] = useState(0);
  const [settings,    setSettings]    = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sa-settings') || '{}');
    } catch (_) { return {}; }
  });

  // Default settings
  const mergedSettings = {
    audioEnabled:     true,
    notifyOnIncrease: true,
    ...settings,
  };

  const prevLevelRef = useRef(null);

  // Persist settings
  const updateSetting = useCallback((key, val) => {
    setSettings(prev => {
      const next = { ...prev, [key]: val };
      try { localStorage.setItem('sa-settings', JSON.stringify(next)); } catch (_) {}
      return next;
    });
  }, []);

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);

      const newLevel  = data.level;
      const prevLevel = prevLevelRef.current;

      if (prevLevel !== null && newLevel > prevLevel) {
        // Threat level increased
        if (mergedSettings.audioEnabled) playAlarm();
        if (newLevel === 3) setFlashTrigger(t => t + 1);

        // Browser notification
        if (mergedSettings.notifyOnIncrease && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('⚠ StrikeAlert — Threat Level Rising', {
              body: `${LEVEL_CONFIG[newLevel].label} — ${(data.articles?.[0]?.title || 'Threat indicators rising')}`,
              icon: '/icon-192.png',
              tag:  'threat-alert',
            });
          } else if (Notification.permission === 'default') {
            Notification.requestPermission();
          }
        }
      }

      prevLevelRef.current = newLevel;
    } catch (err) {
      console.warn('Failed to fetch status:', err);
    }
  }, [mergedSettings.audioEnabled, mergedSettings.notifyOnIncrease]);

  // Initial fetch + polling
  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [fetchStatus]);

  // Inject/update dynamic accent CSS
  const level = status?.level ?? 0;
  const accent = LEVEL_CONFIG[level]?.color || '#00ff88';
  useEffect(() => {
    injectStyles(accent);
    // Update meta theme-color
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', accent);
  }, [accent]);

  // Hide boot screen once we have data
  useEffect(() => {
    if (status !== null) {
      const boot = document.getElementById('boot-screen');
      if (boot) boot.style.display = 'none';
    }
  }, [status]);

  // SW message listener (background sync)
  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const handler = event => {
      if (event.data?.type === 'SYNC_COMPLETE') fetchStatus();
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [fetchStatus]);

  if (!status) return null; // Boot screen is shown via HTML until data arrives

  return (
    <div style={{ minHeight: '100vh', background: '#080808' }}>
      <ScreenFlash trigger={flashTrigger} />
      <Header level={level} activeTab={activeTab} onTabChange={setActiveTab} />

      <main>
        {activeTab === 'DASHBOARD' && <DashboardTab status={status} />}
        {activeTab === 'ALERTS'    && <AlertsTab articles={status.articles} level={level} />}
        {activeTab === 'SURVIVE'   && <SurviveTab />}
        {activeTab === 'ABOUT'     && <AboutTab />}
        {activeTab === 'SETTINGS'  && (
          <SettingsTab
            settings={mergedSettings}
            onSettingsChange={updateSetting}
            level={level}
            checkFrequency={status.checkFrequency}
            onTestAlarm={() => mergedSettings.audioEnabled && playAlarm()}
          />
        )}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center', padding: '24px 16px',
        borderTop: '1px solid #111',
        fontSize: '0.6rem', color: '#222',
        letterSpacing: '0.1em',
      }}>
        STRIKEALERT · STRIKEALERT.APP · ALL SOURCES PUBLIC & FREE
      </footer>
    </div>
  );
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const container = document.getElementById('root');
const reactRoot = ReactDOM.createRoot(container);
reactRoot.render(<App />);
