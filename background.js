// Copyright 2026 Bo Yang
// Licensed under the PolyForm Strict License 1.0.0
// =============================================================================
// AquaPause — Background Service Worker
// =============================================================================

// All shared constants (intervals, sizes, stage waterings, slider bounds)
// live in shared.js and are imported here so there is a single source of truth.
importScripts('shared.js');

// ── Time constants (background-only) ─────────────────────────────────────────
const MS_PER_SECOND            = 1_000;
const MS_PER_MINUTE            = 60 * MS_PER_SECOND;
const MS_PER_HOUR              = 60 * MS_PER_MINUTE;

// ── Alarm ─────────────────────────────────────────────────────────────────────
const CHECK_ALARM_NAME         = 'aquapause_check';
const CHECK_ALARM_PERIOD_MIN   = 1;               // alarm fires every N minutes

// ── Mood / health ─────────────────────────────────────────────────────────────
const MAX_MOOD                 = 100;
const MIN_MOOD                 = 0;

// Decay applied each check cycle while a water reminder is pending
const PENDING_WATER_DECAY = 2;

// Boosts on explicit "done" actions
const WATER_BOOST         = 10;
const STRETCH_BOOST       = 5;

// Boosts for the "quick action" variants (Drink Now / Move Now)
const QUICK_DRINK_BOOST   = 5;
const QUICK_MOVE_BOOST    = 2;

// ── Storage helpers ───────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  initialized:        false,
  isAway:             false,

  // Current companion — full API object + nickname
  // { id, type, name, nickname, description, stages[], messages[] }
  companion:          null,
  moodOrHealth:       MAX_MOOD,
  plantStage:         0,
  plantBloomed:       false,
  wateringsThisStage: 0,
  companionStartedAt: null,

  // Timers
  lastWaterTime:      null,
  lastStretchTime:    null,
  lastActiveTime:     null,
  pendingWater:       false,
  pendingStretch:     false,

  // All-time stats
  totalWaterings:     0,
  totalStretches:     0,

  // User-configurable intervals (ms)
  waterIntervalMs:    WATER_INTERVAL_DEFAULT_MS,
  stretchIntervalMs:  STRETCH_INTERVAL_DEFAULT_MS,
  awayThresholdMs:    AWAY_THRESHOLD_DEFAULT_MS,

  // Companion visual size (px). Widget width/height are derived automatically.
  visualSize:         VISUAL_SIZE_DEFAULT,

  // History of completed (bloomed) plants
  history:            [],

  // Sites where the widget is paused (array of hostname strings)
  pausedDomains:      [],

  // Timestamp (ms) of when the screen was locked; null if not locked.
  // Away is only declared once the lock duration exceeds awayThresholdMs.
  lockedAt:           null,
};

function getState() {
  return new Promise(resolve => chrome.storage.local.get(DEFAULT_STATE, resolve));
}
function setState(updates) {
  return new Promise(resolve => chrome.storage.local.set(updates, resolve));
}

// ── Timer check (called by 1-min alarm) ──────────────────────────────────────
async function checkTimers() {
  const state = await getState();
  if (!state.initialized || !state.companion) return;

  const now             = Date.now();
  const awayThresholdMs = state.awayThresholdMs ?? AWAY_THRESHOLD_DEFAULT_MS;

  // Promote a pending lock to "away" once the threshold has been exceeded.
  if (!state.isAway && state.lockedAt !== null &&
      now - state.lockedAt >= awayThresholdMs) {
    await handleBecameAway();
    return;   // skip reminder logic — user is now away
  }

  if (state.isAway) return;
  const waterIntervalMs   = state.waterIntervalMs   ?? WATER_INTERVAL_DEFAULT_MS;
  const stretchIntervalMs = state.stretchIntervalMs ?? STRETCH_INTERVAL_DEFAULT_MS;
  const updates           = {};

  if (!state.pendingWater && state.lastWaterTime !== null &&
      now - state.lastWaterTime >= waterIntervalMs) {
    updates.pendingWater = true;
  }
  if (!state.pendingStretch && state.lastStretchTime !== null &&
      now - state.lastStretchTime >= stretchIntervalMs) {
    updates.pendingStretch = true;
  }

  const pendingWaterNow = updates.pendingWater ?? state.pendingWater;
  if (pendingWaterNow) {
    const decay = PENDING_WATER_DECAY;
    updates.moodOrHealth = Math.max(MIN_MOOD, (updates.moodOrHealth ?? state.moodOrHealth) - decay);
  }

  if (Object.keys(updates).length > 0) await setState(updates);
}

// ── Idle/lock helpers ─────────────────────────────────────────────────────────
async function handleBecameAway() {
  const now = Date.now();
  await setState({
    isAway:          true,
    lockedAt:        null,   // lock resolved — away is now the authoritative state
    lastWaterTime:   now,
    lastStretchTime: now,
    pendingWater:    false,
    pendingStretch:  false,
  });
}

// Called when the screen is locked.  We record the lock time but do NOT mark
// the user as away yet — checkTimers() will promote to away once the lock has
// lasted longer than awayThresholdMs (so a quick toilet break stays "active").
async function handleBecameLocked() {
  const state = await getState();
  // If already away or already tracking a lock, do nothing.
  if (state.isAway || state.lockedAt !== null) return;
  await setState({ lockedAt: Date.now() });
}

async function handleBecameActive() {
  const now = Date.now();
  const oldState = await getState();
  if (oldState.isAway) {
    await setState({
      isAway:          false,
      lockedAt:        null,   // clear any pending lock timer
      lastWaterTime:   now,
      lastStretchTime: now,
      lastActiveTime:  now,
      pendingWater:    false,
      pendingStretch:  false,
    });
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleWaterDone() {
  const state = await getState();
  const now   = Date.now();

  const updates = {
    lastWaterTime:  now,
    pendingWater:   false,
    totalWaterings: (state.totalWaterings ?? 0) + 1,
  };
  
  updates.moodOrHealth = Math.min(MAX_MOOD, state.moodOrHealth + WATER_BOOST);

  if (state.companion.type === 'plant') {
    // Plant — companion now stored with full def including stages[]
    const stages     = state.companion.stages ?? [];
    const stageLimit = STAGE_WATERINGS[state.plantStage] ?? STAGE_WATERINGS_FALLBACK;
    const newCount   = state.wateringsThisStage + 1;

    if (newCount >= stageLimit) {
      const newStage = state.plantStage + 1;
      updates.wateringsThisStage = 0;

      if (newStage >= stages.length) {
        // 🌸 Full bloom
        const lastStage = stages[stages.length - 1];
        const record = {
          companionId:   state.companion.id,
          companionName: state.companion.nickname ?? state.companion.name,
          imageUrl:      lastStage?.image_url ?? null,
          completedAt:   now,
          startedAt:     state.companionStartedAt,
        };
        updates.history            = [...(state.history || []), record];
        updates.plantBloomed       = true;
        updates.plantStage         = stages.length - 1;
        updates.moodOrHealth       = MAX_MOOD;
      } else {
        updates.plantStage         = newStage;
      }
    } else {
      updates.wateringsThisStage = newCount;
    }
  }

  await setState(updates);
}

async function handleStretchDone() {
  const state = await getState();
  await setState({
    lastStretchTime: Date.now(),
    pendingStretch:  false,
    moodOrHealth:    Math.min(MAX_MOOD, state.moodOrHealth + STRETCH_BOOST),
    totalStretches:  (state.totalStretches ?? 0) + 1,
  });
}

async function handleDrinkNow() {
  const state = await getState();
  await setState({
    lastWaterTime:  Date.now(),
    pendingWater:   false,
    totalWaterings: (state.totalWaterings ?? 0) + 1,
    moodOrHealth:   Math.min(MAX_MOOD, (state.moodOrHealth ?? MAX_MOOD) + QUICK_DRINK_BOOST),
  });
}

async function handleMoveNow() {
  const state = await getState();
  await setState({
    lastStretchTime: Date.now(),
    pendingStretch:  false,
    totalStretches:  (state.totalStretches ?? 0) + 1,
    moodOrHealth:    Math.min(MAX_MOOD, (state.moodOrHealth ?? MAX_MOOD) + QUICK_DRINK_BOOST),
  });
}

async function handlePageActive() {
  const state = await getState();
  if (state.isAway) return;
  await setState({ lastActiveTime: Date.now() });
  await checkTimers();
}

// companion = full API object from the store { id, type, name, description, stages[], messages[] }
// plus an optional nickname field set by the picker.
async function handleSelectCompanion(companion) {
  const now = Date.now();
  await setState({
    initialized:        true,
    companion: {
      ...companion,
      nickname: companion.nickname ?? companion.name,
    },
    moodOrHealth:       MAX_MOOD,
    plantStage:         0,
    plantBloomed:       false,
    wateringsThisStage: 0,
    companionStartedAt: now,
    lastWaterTime:      now,
    lastStretchTime:    now,
    lastActiveTime:     now,
    pendingWater:       false,
    pendingStretch:     false,
  });
}

async function handleNewSeed() {
  await setState({
    companion:          null,
    plantStage:         0,
    plantBloomed:       false,
    wateringsThisStage: 0,
    companionStartedAt: null,
    moodOrHealth:       MAX_MOOD,
    pendingWater:       false,
    pendingStretch:     false,
  });
}

async function handleRenameCompanion({ nickname }) {
  const state = await getState();
  if (!state.companion) return;
  const trimmed = (nickname ?? '').trim();
  if (!trimmed) return;
  await setState({ companion: { ...state.companion, nickname: trimmed } });
}

async function handleSaveConfig({ waterIntervalMs, stretchIntervalMs, awayThresholdMs, visualSize }) {
  const updates = {};
  if (Number.isFinite(waterIntervalMs)   && waterIntervalMs   >= MIN_INTERVAL_MS)
    updates.waterIntervalMs   = waterIntervalMs;
  if (Number.isFinite(stretchIntervalMs) && stretchIntervalMs >= MIN_INTERVAL_MS)
    updates.stretchIntervalMs = stretchIntervalMs;
  if (Number.isFinite(awayThresholdMs)   && awayThresholdMs   >= MIN_INTERVAL_MS) {
    updates.awayThresholdMs = awayThresholdMs;
    armIdleDetection(Math.round(awayThresholdMs / MS_PER_SECOND));
  }
  if (Number.isFinite(visualSize) && visualSize >= VISUAL_SIZE_MIN && visualSize <= VISUAL_SIZE_MAX)
    updates.visualSize = visualSize;

  if (Object.keys(updates).length) {
    const now = Date.now();
    // Only reset timers when interval values actually changed
    if (updates.waterIntervalMs || updates.stretchIntervalMs) {
      updates.lastWaterTime   = now;
      updates.lastStretchTime = now;
      updates.pendingWater    = false;
      updates.pendingStretch  = false;
    }
    await setState(updates);
  }
}

async function handleResetAll() {
  await chrome.storage.local.clear();
  await setState(DEFAULT_STATE);
}

async function handleResetStats() {
  await setState({ totalWaterings: 0, totalStretches: 0 });
}

// ── Site pause / resume ──────────────────────────────────────────────────────
async function handlePauseSite(hostname) {
  const state   = await getState();
  const domains = state.pausedDomains ?? [];
  if (!domains.includes(hostname)) {
    await setState({ pausedDomains: [...domains, hostname] });
  }
}

async function handleResumeSite(hostname) {
  const state   = await getState();
  const domains = (state.pausedDomains ?? []).filter(d => d !== hostname);
  await setState({ pausedDomains: domains });
}

// ── Message router ────────────────────────────────────────────────────────────
async function buildResponse() {
  const state = await getState();
  return { state };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_STATE':        sendResponse(await buildResponse()); break;
      case 'PAGE_ACTIVE':      await handlePageActive();                       sendResponse(await buildResponse()); break;
      case 'SELECT_COMPANION': await handleSelectCompanion(message.companion); sendResponse(await buildResponse()); break;
      case 'CHANGE_COMPANION': await handleSelectCompanion(message.companion); sendResponse(await buildResponse()); break;
      case 'WATER_DONE':       await handleWaterDone();                        sendResponse(await buildResponse()); break;
      case 'STRETCH_DONE':     await handleStretchDone();                      sendResponse(await buildResponse()); break;
      case 'DRINK_NOW':        await handleDrinkNow();                         sendResponse(await buildResponse()); break;
      case 'MOVE_NOW':         await handleMoveNow();                          sendResponse(await buildResponse()); break;
      case 'NEW_SEED':         await handleNewSeed();                          sendResponse(await buildResponse()); break;
      case 'RENAME_COMPANION': await handleRenameCompanion(message);           sendResponse(await buildResponse()); break;
      case 'SAVE_CONFIG':      await handleSaveConfig(message);                sendResponse(await buildResponse()); break;
      case 'RESET_ALL':        await handleResetAll();                         sendResponse(await buildResponse()); break;
      case 'RESET_STATS':      await handleResetStats();                       sendResponse(await buildResponse()); break;
      case 'PAUSE_SITE': {
        const hostname = message.hostname ||
          (() => { try { return new URL(_sender.tab?.url ?? '').hostname; } catch { return null; } })();
        if (hostname) await handlePauseSite(hostname);
        sendResponse(await buildResponse());
        break;
      }
      case 'RESUME_SITE': {
        const hostname = message.hostname;
        if (hostname) await handleResumeSite(hostname);
        sendResponse(await buildResponse());
        break;
      }
      case 'OPEN_OPTIONS':
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        break;
      default:
        sendResponse(await buildResponse());
    }
  })();
  return true;
});

// ── Alarm: periodic timer check ──────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CHECK_ALARM_NAME) checkTimers();
});

// ── chrome.idle: authoritative source of away/active state ───────────────────
chrome.idle.onStateChanged.addListener(async (newState) => {
  if (newState === 'idle') {
    // idle threshold is already enforced by chrome via setDetectionInterval,
    // so we can go straight to away.
    await handleBecameAway();
  } else if (newState === 'locked') {
    // Don't go away immediately — start the lock timer and let checkTimers()
    // decide once awayThresholdMs has elapsed.
    await handleBecameLocked();
  } else if (newState === 'active') {
    await handleBecameActive();
  }
});

function armIdleDetection(thresholdSec) {
  chrome.idle.setDetectionInterval(thresholdSec ?? Math.round(AWAY_THRESHOLD_DEFAULT_MS / MS_PER_SECOND));
}

async function queryIdleStateOnStartup() {
  const state = await getState();
  const sec   = Math.round((state.awayThresholdMs ?? AWAY_THRESHOLD_DEFAULT_MS) / MS_PER_SECOND);
  armIdleDetection(sec);
  chrome.idle.queryState(sec, async (currentState) => {
    if (currentState === 'idle') {
      await handleBecameAway();
    } else if (currentState === 'locked') {
      // Treat an already-locked screen at startup the same as receiving a
      // 'locked' event — start the timer; checkTimers() will promote to away.
      await handleBecameLocked();
    } else {
      if (state.isAway) await handleBecameActive();
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: CHECK_ALARM_PERIOD_MIN });
  queryIdleStateOnStartup();
  chrome.storage.local.get('initialized', r => {
    if (!r.initialized) chrome.storage.local.set(DEFAULT_STATE);
  });
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: CHECK_ALARM_PERIOD_MIN });
  queryIdleStateOnStartup();
});

// ── Service worker restart guard ──────────────────────────────────────────────
(async function onServiceWorkerRestart() {
  chrome.alarms.create(CHECK_ALARM_NAME, { periodInMinutes: CHECK_ALARM_PERIOD_MIN });
  queryIdleStateOnStartup();
})();
