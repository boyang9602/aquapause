// Copyright 2026 Bo Yang
// Licensed under the PolyForm Strict License 1.0.0
// =============================================================================
// AquaPause — Toolbar popup
// Depends on shared.js. Shows companion details (health, growth, timers)
// and lets the user pause/resume on the current site.
// Companion data comes from state.companion (full API def stored there).
// =============================================================================
'use strict';

let appState = null;
let currentHostname = null;  // resolved once at startup

// ── Raw callback messenger (no Promise wrapper) ───────────────────────────────
function sendMsgCb(msg, cb) {
  try {
    chrome.runtime.sendMessage(msg, function (res) {
      if (chrome.runtime.lastError) {
        // SW unavailable — fall back to a direct storage read
        chrome.storage.local.get(null, function (data) { if (cb) cb(null); });
        return;
      }
      if (cb) cb(res);
    });
  } catch (e) {
    if (cb) cb(null);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  const pausedDomains = appState?.pausedDomains ?? [];
  const isPaused      = currentHostname ? pausedDomains.includes(currentHostname) : false;

  renderCompanion();
  renderTimers();
  renderDomain(currentHostname, isPaused);
}

// ── Companion section ─────────────────────────────────────────────────────────
function renderCompanion() {
  const compEl   = document.getElementById('comp-section');
  const healthEl = document.getElementById('health-section');
  const growthEl = document.getElementById('growth-section');

  if (!appState?.companion) {
    compEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:14px 16px;background:linear-gradient(135deg,#1a252f,#2c3e50);color:#fff;font-size:13px;line-height:1.5;cursor:pointer;';
    msg.innerHTML = `🌿 No companion yet.<br><small>Open Settings to pick one!</small>`;
    msg.addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
    compEl.appendChild(msg);
    healthEl.innerHTML = '';
    growthEl.innerHTML = '';
    return;
  }

  const def    = getCompDef(appState);
  const visual = getCompVisual(appState);
  const name   = getDisplayName(appState);
  const mood   = getMoodLabel(appState);
  const health = appState.moodOrHealth;

  // Companion section
  compEl.innerHTML = '';
  const section    = document.createElement('div');
  section.className = 'comp-section';
  section.title     = 'Open settings';

  const visualWrap = document.createElement('div');
  visualWrap.className = 'comp-visual';
  visualWrap.appendChild(buildVisualEl(visual, 42));
  section.appendChild(visualWrap);

  const info = document.createElement('div');
  info.innerHTML = `<div class="comp-name">${name}</div><div class="comp-sub">${mood}</div>`;
  section.appendChild(info);

  section.addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
  compEl.appendChild(section);

  // Health bar
  const hClass = getHealthClass(health);
  healthEl.innerHTML = `
    <div class="health-row">
      <div class="health-label">
        <span>${def?.type === 'animal' ? 'Mood' : 'Health'}</span>
        <span>${health}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill ${hClass}" style="width:${health}%"></div>
      </div>
    </div>`;

  // Growth section (plants only)
  if (def?.type === 'plant') {
    const stages = def.stages ?? [];
    if (appState.plantBloomed) {
      growthEl.innerHTML = `
        <div class="growth-section">
          <div class="section-label">Growth</div>
          <div style="font-size:12px;font-weight:700;color:#2e7d52;">🌸 In full bloom!</div>
        </div>`;
    } else {
      const stagePips = stages.map((_, i) => {
        const cls = i < appState.plantStage ? 'done' : i === appState.plantStage ? 'current' : '';
        return `<div class="stage-pip ${cls}"></div>`;
      }).join('');
      const currentStageName = stages[appState.plantStage]?.name ?? '';
      const nextStageName    = stages[appState.plantStage + 1]?.name ?? 'Bloom';
      const stageLimit = STAGE_WATERINGS[appState.plantStage] ?? 5;
      const filled     = Math.min(appState.wateringsThisStage, stageLimit);
      const wdots = Array.from({ length: stageLimit }, (_, i) =>
        `<div class="wdot ${i < filled ? 'filled' : ''}"></div>`
      ).join('');

      growthEl.innerHTML = `
        <div class="growth-section">
          <div class="section-label">Growth · ${currentStageName}</div>
          <div class="stage-track">${stagePips}</div>
          <div class="stage-name-row">
            <span>${stages[0]?.name ?? ''}</span>
            <span>${stages.at(-1)?.name ?? ''}</span>
          </div>
          <div class="water-progress" style="margin-top:8px;">
            ${wdots}
            <span class="wdot-label">${filled}/${stageLimit} to ${nextStageName}</span>
          </div>
        </div>`;
    }
  } else {
    growthEl.innerHTML = '';
  }
}

// ── Timers section ────────────────────────────────────────────────────────────
function renderTimers() {
  const el = document.getElementById('timers-section');
  if (!appState?.companion) { el.innerHTML = ''; return; }

  const wI  = appState.waterIntervalMs   ?? WATER_INTERVAL_DEFAULT_MS;
  const sI  = appState.stretchIntervalMs ?? STRETCH_INTERVAL_DEFAULT_MS;
  const wCD = appState.pendingWater   ? 'Due now!' : fmtCountdown(appState.lastWaterTime,   wI);
  const sCD = appState.pendingStretch ? 'Due now!' : fmtCountdown(appState.lastStretchTime, sI);

  el.innerHTML = `
    <div class="timers-row">
      <div class="timer-chip ${appState.pendingWater   ? 'due' : ''}">
        <div class="timer-val">${wCD}</div>
        <div class="timer-label">💧 Water</div>
      </div>
      <div class="timer-chip ${appState.pendingStretch ? 'due' : ''}">
        <div class="timer-val">${sCD}</div>
        <div class="timer-label">🚶 Break</div>
      </div>
    </div>`;
}

// ── Domain + pause/resume ─────────────────────────────────────────────────────
function renderDomain(hostname, isPaused) {
  const domainEl = document.getElementById('domain-name');
  const badgeEl  = document.getElementById('domain-badge');
  const btn      = document.getElementById('pause-btn');

  if (!hostname) {
    domainEl.textContent = 'Not a webpage';
    badgeEl.textContent  = '';
    badgeEl.className    = 'domain-badge';
    btn.textContent      = 'Not available here';
    btn.className        = 'btn-pause pause';
    btn.disabled         = true;
    return;
  }

  domainEl.textContent = hostname;
  badgeEl.textContent  = isPaused ? 'Paused' : 'Active';
  badgeEl.className    = `domain-badge ${isPaused ? 'paused' : 'active'}`;
  btn.disabled         = false;

  // Clone to drop any previously attached listener
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  if (isPaused) {
    newBtn.textContent = '▶  Resume on this site';
    newBtn.className   = 'btn-pause resume';
    newBtn.addEventListener('click', () => {
      sendMsgCb({ type: 'RESUME_SITE', hostname }, res => {
        if (res) { appState = res.state; renderAll(); }
      });
    });
  } else {
    newBtn.textContent = '⏸  Pause on this site';
    newBtn.className   = 'btn-pause pause';
    newBtn.addEventListener('click', () => {
      sendMsgCb({ type: 'PAUSE_SITE', hostname }, res => {
        if (res) { appState = res.state; renderAll(); }
      });
    });
  }
}

// ── Init — nested callbacks, zero promises ────────────────────────────────────
document.getElementById('settings-link').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// 1. Resolve active tab hostname
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  const url = tabs?.[0]?.url ?? '';
  try { currentHostname = new URL(url).hostname || null; }
  catch { currentHostname = null; }

  // 2. Read state directly from storage — no SW round-trip
  chrome.storage.local.get(null, data => {
    appState = data;
    renderAll();
  });
});
