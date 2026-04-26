// =============================================================================
// AquaPause — Shared utilities
// Loaded by widget.html, options.html, and popup.html via defer.
// All companion helpers read from state.companion directly (full def stored there).
// =============================================================================
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

// Default reminder intervals
const WATER_INTERVAL_DEFAULT_MS   = 60 * 60 * 1000;    // 1 hour
const STRETCH_INTERVAL_DEFAULT_MS = 30 * 60 * 1000;    // 30 minutes
const AWAY_THRESHOLD_DEFAULT_MS   = 15 * 60 * 1000;    // 15 minutes
const MIN_INTERVAL_MS             =  5 * 60 * 1000;    // shortest allowed interval

// Slider bounds (minutes) — single source of truth for both options.html and
// background.js validation. Changing these values here is sufficient.
const WATER_INTERVAL_MIN_MIN      =   5;
const WATER_INTERVAL_MAX_MIN      = 120;
const STRETCH_INTERVAL_MIN_MIN    =   5;
const STRETCH_INTERVAL_MAX_MIN    =  90;
const AWAY_THRESHOLD_MIN_MIN      =   5;
const AWAY_THRESHOLD_MAX_MIN      =  60;

// Companion visual size (px)
const VISUAL_SIZE_DEFAULT         = 140;
const VISUAL_SIZE_MIN             =  50;
const VISUAL_SIZE_MAX             = 250;

// Named size presets rendered as quick-pick buttons in the options page
const VISUAL_SIZE_PRESETS = [
  { label: 'Small',  px: 80 },
  { label: 'Medium', px: 140 },
  { label: 'Large',  px: 180 },
];

// Plant growth — waterings needed to advance from each stage index
const STAGE_WATERINGS             = [1, 5, 10];
const STAGE_WATERINGS_FALLBACK    = 5;   // used when stage index is out of range

// ── Companion API ─────────────────────────────────────────────────────────────
const COMPANIONS_API_URL = 'https://zxuhspvxsqegdykokfqd.supabase.co/rest/v1/companions';
const COMPANIONS_API_KEY = 'sb_publishable_XpuVwRfINS4I_62yER1iyQ_hQB01wza';

async function fetchCompanionsFromAPI() {
  const res = await fetch(`${COMPANIONS_API_URL}?select=*&order=type,name`, {
    headers: {
      'apikey':        COMPANIONS_API_KEY,
      'Authorization': `Bearer ${COMPANIONS_API_KEY}`,
      'Content-Type':  'application/json',
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json(); // returns array of companion objects
}

// ── Messaging ─────────────────────────────────────────────────────────────────
function sendMsg(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) { resolve(null); return; }
        resolve(res);
      });
    } catch { resolve(null); }
  });
}

// ── Companion helpers ─────────────────────────────────────────────────────────
// The selected companion is now stored in full in state.companion
// (id, type, name, nickname, description, stages[], messages[]).
// These helpers only need `state` — no separate companions catalog.

function getCompDef(state) {
  return state?.companion ?? null;
}

// Returns an image URL string for the current visual, or null if unavailable.
// API structure:  stages[i].image_url  (always an image URL or absent)
// Animals: 3 stages = [happy, neutral, sad] mapped by moodOrHealth
//          1-2 stages = always show stage 0
// Plants:  stage index = state.plantStage
function getCompVisual(state) {
  const stages = state?.companion?.stages ?? [];

  if (state?.companion?.type === 'plant') {
    const idx = Math.min(state.plantStage ?? 0, stages.length - 1);
    return stages[idx]?.image_url ?? null;
  }

  // Animal (or unknown type) — mood-based stage selection
  if (stages.length >= 3) {
    const h = state.moodOrHealth ?? 100;
    const idx = 0;
    return stages[idx]?.image_url ?? null;
  }

  return stages[0]?.image_url ?? null;
}

// Water / move reminder messages from the companion's messages[] array.
function getWaterMessage(state) {
  return state?.companion?.messages?.find(m => m.name === 'drink')?.content
    ?? 'Time to drink water! 💧';
}
function getMoveMessage(state) {
  return state?.companion?.messages?.find(m => m.name === 'move')?.content
    ?? 'Time to take a break! 🚶';
}

// Renders a companion image into a DOM element.
// Returns the created <img>, or null if url is null. onLoad fires once the image is ready.
function buildVisualEl(visual, size = 52, onLoad = null) {
  if (!visual) return null;

  const img = document.createElement('img');
  img.alt      = 'companion';
  img.loading  = 'eager';
  img.decoding = 'sync';
  img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;display:block;`;

  let retries = 0;
  img.onerror = () => {
    if (retries++ < 3) {
      const sep = visual.includes('?') ? '&' : '?';
      setTimeout(() => { img.src = `${visual}${sep}_r=${retries}`; }, 400 * retries);
    } else if (onLoad) {
      onLoad();
    }
  };
  img.onload = () => { if (onLoad) onLoad(); };
  img.src = visual;
  return img;
}

function getMoodLabel(state) {
  if (!state?.companion) return '';
  const h   = state.moodOrHealth;
  const def = state.companion;
  if (def.type === 'animal') {
    if (h >= 80) return 'Very happy 😊';
    if (h >= 60) return 'Happy 🙂';
    if (h >= 40) return 'Neutral 😐';
    if (h >= 20) return 'Sad 😢';
    return 'Very sad 😭';
  }
  if (state.plantBloomed) return '🌸 Bloomed!';
  const stages = def.stages ?? [];
  return stages[Math.min(state.plantStage ?? 0, stages.length - 1)]?.name ?? '';
}

function getDisplayName(state) {
  return state?.companion?.nickname ?? state?.companion?.name ?? '';
}

function getHealthClass(health) {
  return health >= 60 ? 'high' : health >= 30 ? 'medium' : 'low';
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtCountdown(lastTime, intervalMs) {
  if (!lastTime) return '—';
  const rem = intervalMs - (Date.now() - lastTime);
  if (rem <= 0) return 'Now!';
  const m = Math.ceil(rem / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDuration(startTs) {
  if (!startTs) return null;
  const diff  = Date.now() - startTs;
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  if (days  > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ── Storage loader ────────────────────────────────────────────────────────────
// Companions are no longer cached in storage — they are fetched live from the
// API in the options page. Widget and popup use state.companion (full def).
async function loadFromStorage() {
  const state = await new Promise(resolve => chrome.storage.local.get(null, resolve));
  return { state };
}
