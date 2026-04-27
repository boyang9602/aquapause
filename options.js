// Copyright 2026 Bo Yang
// Licensed under the PolyForm Strict License 1.0.0
// =============================================================================
// AquaPause — Options page logic
// Depends on shared.js (loaded first via defer in options.html).
// Companions are fetched live from the API — not cached in storage.
// state.companion holds the full companion definition once selected.
// =============================================================================
'use strict';

let appState      = null;   // chrome.storage state
let allCompanions = [];     // full list from API
let filteredList  = [];     // after type filter + search
let pickId        = null;   // currently highlighted companion id in store
let activeType    = 'all';  // active type-filter value
let searchQuery   = '';     // current search string

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── API — fetch companions ────────────────────────────────────────────────────
async function loadCompanionsFromAPI() {
  const grid    = document.getElementById('store-grid');
  const pillBar = document.getElementById('filter-pills');

  grid.innerHTML = '<div class="store-loading">Loading companions…</div>';

  try {
    allCompanions = await fetchCompanionsFromAPI();
  } catch (err) {
    grid.innerHTML = `<div class="store-error">⚠️ Failed to load companions. Check your connection and reload.<br><small>${err.message}</small></div>`;
    return;
  }

  // Build type-filter pills dynamically from returned data
  const types = ['all', ...new Set(allCompanions.map(c => c.type?.toLowerCase()).filter(Boolean))];
  pillBar.innerHTML = types.map(t =>
    `<button class="filter-pill ${t === activeType ? 'active' : ''}" data-type="${t}">${t === 'all' ? 'All' : capitalize(t)}</button>`
  ).join('');
  pillBar.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      activeType = btn.dataset.type;
      pillBar.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  applyFilters();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Filter + search ───────────────────────────────────────────────────────────
function applyFilters() {
  const q = searchQuery.toLowerCase().trim();
  filteredList = allCompanions.filter(c => {
    const matchType   = activeType === 'all' || (c.type?.toLowerCase() === activeType);
    const matchSearch = !q ||
      c.name?.toLowerCase().includes(q) ||
      c.description?.toLowerCase().includes(q) ||
      c.type?.toLowerCase().includes(q);
    return matchType && matchSearch;
  });
  renderStoreGrid();
}

// ── Store grid ────────────────────────────────────────────────────────────────
function renderStoreGrid() {
  const grid    = document.getElementById('store-grid');
  const btn     = document.getElementById('select-companion-btn');
  const countEl = document.getElementById('store-count');
  const warn    = document.getElementById('change-warning');

  warn.style.display = appState?.companion ? 'block' : 'none';
  warn.textContent   = appState?.companion
    ? '⚠️ Selecting a new companion abandons the current one without history credit. Stats and history are unaffected.'
    : '';

  countEl.textContent = filteredList.length
    ? `${filteredList.length} companion${filteredList.length !== 1 ? 's' : ''}`
    : '';

  if (!filteredList.length) {
    grid.innerHTML = '<div class="store-loading">No companions match your search.</div>';
    btn.disabled    = true;
    btn.textContent = 'Select a companion';
    return;
  }

  grid.innerHTML = '';
  filteredList.forEach(c => {
    const isSelected = pickId === c.id;

    // Use the first stage image as the store preview
    const firstStage = (c.stages ?? [])[0];
    const previewUrl = firstStage?.image_url ?? null;

    const card = document.createElement('div');
    card.className = `comp-option ${isSelected ? 'sel' : ''}`;
    card.dataset.id = c.id;

    const visualDiv = document.createElement('div');
    visualDiv.className = 'opt-visual';
    if (previewUrl) {
      const img = document.createElement('img');
      img.src = previewUrl;
      img.alt = c.name;
      img.width  = 88;
      img.height = 88;
      img.style.objectFit = 'contain';
      visualDiv.appendChild(img);
    } else {
      visualDiv.textContent = c.type === 'plant' ? '🌱' : '🐾';
      visualDiv.style.fontSize = '36px';
    }

    card.appendChild(visualDiv);
    card.innerHTML += `
      <div class="opt-name">${c.name}</div>
      <div class="opt-desc">${c.description ?? ''}</div>
      <span class="opt-type-badge">${c.type ?? ''}</span>`;

    card.addEventListener('click', () => {
      pickId = c.id;
      renderStoreGrid();
    });

    grid.appendChild(card);
  });

  const chosen = filteredList.find(c => c.id === pickId);
  btn.disabled    = !chosen;
  btn.textContent = chosen
    ? `${appState?.companion ? 'Switch to' : 'Start with'} ${chosen.name}! 🚀`
    : 'Select a companion';
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  if (!appState) return;

  const card = document.getElementById('dash-companion-card');
  const def  = getCompDef(appState);

  if (!appState.companion || !def) {
    card.innerHTML = `
      <div class="card-header"><span class="icon">🐾</span><div><h2>Your Companion</h2><p>No companion selected</p></div></div>
      <div class="card-body">
        <div class="no-comp"><div class="big">🌱</div><p>Go to the <strong>Store</strong> tab to pick one!</p></div>
      </div>`;
    return;
  }

  const health   = appState.moodOrHealth;
  const visual   = getCompVisual(appState);
  const nickname = getDisplayName(appState);
  const duration = fmtDuration(appState.companionStartedAt);
  const stages   = def.stages ?? [];

  let extraHTML = '';
  if (def.type === 'plant') {
    if (appState.plantBloomed) {
      const lastStage = stages.at(-1);
      const bloomVisual = lastStage?.image_url
        ? `<img src="${lastStage.image_url}" style="width:40px;height:40px;object-fit:contain;">`
        : '🌸';
      extraHTML = `
        <div class="bloom-card">
          <div class="bloom-big">${bloomVisual}</div>
          <div class="bloom-title">${nickname} is in full bloom!</div>
          <div class="bloom-sub">Tap below when you're ready to start fresh.</div>
          <button class="btn btn-gold" id="dash-new-seed-btn">🌱 Plant a new seed</button>
        </div>`;
    } else {
      const stageDots = stages.map((s, i) => {
        const cls = i < appState.plantStage ? 'done' : i === appState.plantStage ? 'current' : 'future';
        const thumb = s.image_url
          ? `<img src="${s.image_url}" style="width:16px;height:16px;object-fit:contain;">`
          : '○';
        return `<div class="stage-item">
          <div class="stage-dot ${cls}">${thumb}</div>
          <div class="stage-name">${s.name}</div>
        </div>`;
      }).join('');

      const stageLimit  = STAGE_WATERINGS[appState.plantStage] ?? STAGE_WATERINGS_FALLBACK;
      const filledCount = Math.min(appState.wateringsThisStage, stageLimit);
      const wdots = Array.from({ length: stageLimit }, (_, i) =>
        `<div class="wdot ${i < filledCount ? 'filled' : ''}"></div>`
      ).join('');

      extraHTML = `
        <div class="stage-section">
          <div class="stage-title">Growth stages</div>
          <div class="stage-row">${stageDots}</div>
          <div class="water-stage-block">
            <div class="water-stage-title">Progress to ${stages[appState.plantStage + 1]?.name ?? 'Bloom'}</div>
            <div class="water-dots">${wdots}</div>
            <div class="water-stage-label">${filledCount} of ${stageLimit} waterings completed</div>
          </div>
        </div>`;
    }
  }

  card.innerHTML = `
    <div class="card-header">
      <span class="icon">🐾</span>
      <div><h2>Your Companion</h2><p>${def.description ?? ''}${duration ? ` · Active for ${duration}` : ''}</p></div>
    </div>
    <div class="card-body">
      <div class="comp-display">
        <div id="dash-comp-visual" style="flex-shrink:0;"></div>
        <div class="comp-info">
          <div style="font-size:18px;font-weight:800;color:#1a252f;margin-bottom:2px;">${nickname}</div>
          <div style="font-size:11.5px;color:#95a5a6;margin-bottom:6px;">${getMoodLabel(appState)}</div>
          <div class="bar-wrap">
            <div class="bar-label"><span>${def.type === 'animal' ? 'Mood' : 'Health'}</span><span>${health}%</span></div>
            <div class="bar-track">
              <div class="bar-fill ${getHealthClass(health)}" style="width:${health}%"></div>
            </div>
          </div>
        </div>
      </div>
      ${extraHTML}
    </div>`;

  const dashVisualEl = document.getElementById('dash-comp-visual');
  if (dashVisualEl) dashVisualEl.appendChild(buildVisualEl(visual, 52));

  card.querySelector('#dash-new-seed-btn')?.addEventListener('click', async () => {
    if (!confirm('Plant a new seed? Your current bloomed plant will be replaced.')) return;
    const res = await sendMsg({ type: 'NEW_SEED' });
    if (res) { appState = res.state; renderAll(); toast('🌱 New seed planted!'); }
  });

  // Timers
  const wI = appState.waterIntervalMs   ?? WATER_INTERVAL_DEFAULT_MS;
  const sI = appState.stretchIntervalMs ?? STRETCH_INTERVAL_DEFAULT_MS;
  document.getElementById('water-countdown').textContent  = appState.pendingWater   ? 'Due now!' : fmtCountdown(appState.lastWaterTime,   wI);
  document.getElementById('stretch-countdown').textContent = appState.pendingStretch ? 'Due now!' : fmtCountdown(appState.lastStretchTime, sI);
  document.getElementById('water-chip').className  = `timer-chip ${appState.pendingWater   ? 'due' : ''}`;
  document.getElementById('stretch-chip').className = `timer-chip ${appState.pendingStretch ? 'due' : ''}`;

  // Stats
  document.getElementById('stat-waterings').textContent = appState.totalWaterings ?? 0;
  document.getElementById('stat-stretches').textContent = appState.totalStretches ?? 0;
  document.getElementById('stat-plants').textContent    = (appState.history ?? []).length;

  let days = 0;
  if (appState.companionStartedAt) {
    days = Math.max(1, Math.floor((Date.now() - appState.companionStartedAt) / 86400000));
  } else if ((appState.history ?? []).length > 0) {
    const earliest = Math.min(...appState.history.map(h => h.startedAt ?? h.completedAt));
    days = Math.max(1, Math.floor((Date.now() - earliest) / 86400000));
  }
  document.getElementById('stat-days').textContent = days;
}

// ── Current companion card (Store tab) ────────────────────────────────────────
function renderCurrentCompanionCard() {
  const card = document.getElementById('current-companion-card');
  if (!appState?.companion) { card.style.display = 'none'; return; }

  const def      = getCompDef(appState);
  const nickname = getDisplayName(appState);
  const visual   = getCompVisual(appState);

  card.style.display = '';
  card.innerHTML = `
    <div class="card-header">
      <span id="curr-comp-icon"></span>
      <div><h2>Current Companion</h2><p>Edit nickname or plant a new seed</p></div>
    </div>
    <div class="card-body">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span id="curr-comp-visual"></span>
        <div style="flex:1;">
          <div class="nickname-edit">
            <input class="nickname-field" id="nickname-field" type="text"
              maxlength="24" value="${nickname}" placeholder="${appState.companion.name}" />
            <span class="species-tag">${appState.companion.name}</span>
          </div>
          <div class="nickname-hint">Species: ${appState.companion.name}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn btn-primary" id="save-nickname-btn">💾 Save Nickname</button>
        ${def?.type === 'plant' && appState.plantBloomed
          ? `<button class="btn btn-gold" id="comp-new-seed-btn">🌱 Plant new seed</button>`
          : ''}
      </div>
    </div>`;

  const iconEl   = card.querySelector('#curr-comp-icon');
  const visualEl = card.querySelector('#curr-comp-visual');
  if (iconEl)   iconEl.appendChild(buildVisualEl(visual, 20));
  if (visualEl) visualEl.appendChild(buildVisualEl(visual, 40));

  card.querySelector('#save-nickname-btn').addEventListener('click', async () => {
    const val = card.querySelector('#nickname-field').value.trim();
    if (!val) { toast('⚠️ Nickname cannot be empty.'); return; }
    const res = await sendMsg({ type: 'RENAME_COMPANION', nickname: val });
    if (res) { appState = res.state; renderAll(); toast(`✅ Renamed to "${val}"`); }
  });
  card.querySelector('#comp-new-seed-btn')?.addEventListener('click', async () => {
    if (!confirm('Plant a new seed? Your bloomed plant will be replaced.')) return;
    const res = await sendMsg({ type: 'NEW_SEED' });
    if (res) { appState = res.state; renderAll(); toast('🌱 New seed planted!'); }
  });
}

// ── Config ────────────────────────────────────────────────────────────────────
function renderConfig() {
  if (!appState) return;
  const waterMin   = Math.round((appState.waterIntervalMs   ?? WATER_INTERVAL_DEFAULT_MS)  / 60000);
  const stretchMin = Math.round((appState.stretchIntervalMs ?? STRETCH_INTERVAL_DEFAULT_MS) / 60000);
  const awayMin    = Math.round((appState.awayThresholdMs   ?? AWAY_THRESHOLD_DEFAULT_MS)   / 60000);
  const visualPx   = appState.visualSize ?? VISUAL_SIZE_DEFAULT;

  // Set slider bounds from shared constants (single source of truth)
  const waterRange   = document.getElementById('water-range');
  const stretchRange = document.getElementById('stretch-range');
  const awayRange    = document.getElementById('away-range');
  const sizeRange    = document.getElementById('size-range');

  waterRange.min   = WATER_INTERVAL_MIN_MIN;    waterRange.max   = WATER_INTERVAL_MAX_MIN;
  stretchRange.min = STRETCH_INTERVAL_MIN_MIN;  stretchRange.max = STRETCH_INTERVAL_MAX_MIN;
  awayRange.min    = AWAY_THRESHOLD_MIN_MIN;    awayRange.max    = AWAY_THRESHOLD_MAX_MIN;
  sizeRange.min    = VISUAL_SIZE_MIN;           sizeRange.max    = VISUAL_SIZE_MAX;

  waterRange.value   = waterMin;
  stretchRange.value = stretchMin;
  awayRange.value    = awayMin;
  sizeRange.value    = visualPx;

  document.getElementById('water-badge').textContent   = `${waterMin} min`;
  document.getElementById('stretch-badge').textContent = `${stretchMin} min`;
  document.getElementById('away-badge').textContent    = `${awayMin} min`;
  document.getElementById('size-badge').textContent    = `${visualPx} px`;

  // Highlight matching preset button
  document.querySelectorAll('.size-preset-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.size) === visualPx);
  });
}

// ── History ───────────────────────────────────────────────────────────────────
function renderHistory() {
  if (!appState) return;
  const body = document.getElementById('history-body');
  const hist = [...(appState.history ?? [])].reverse();
  if (!hist.length) {
    body.innerHTML = `<div class="hist-empty">🌱 No completed plants yet — keep growing!</div>`;
    return;
  }
  body.innerHTML = `<div class="hist-list">` + hist.map(h => {
    const days   = h.startedAt ? Math.max(1, Math.floor((h.completedAt - h.startedAt) / 86400000)) : null;
    const imgTag = h.imageUrl
      ? `<img src="${h.imageUrl}" alt="${h.companionName}">`
      : '🌸';
    return `
      <div class="hist-row">
        <div class="hist-icon">${imgTag}</div>
        <div>
          <div class="hist-name">${h.companionName}</div>
          <div class="hist-meta">Completed ${fmtDate(h.completedAt)}${days ? ` · ${days}d to grow` : ''}</div>
        </div>
        <span class="hist-badge">🌸 Bloomed</span>
      </div>`;
  }).join('') + `</div>`;
}

// ── Paused sites ─────────────────────────────────────────────────────────────
function renderPausedSites() {
  if (!appState) return;
  const body    = document.getElementById('paused-sites-body');
  const domains = appState.pausedDomains ?? [];

  if (!domains.length) {
    body.innerHTML = `<div class="hist-empty">No paused sites — AquaPause is active everywhere.</div>`;
    return;
  }

  body.innerHTML = `<div class="hist-list">` + domains.map(domain => `
    <div class="hist-row">
      <div class="hist-icon">🌐</div>
      <div class="hist-name">${domain}</div>
      <button class="btn btn-outline" style="padding:6px 12px;font-size:12px;"
        data-resume="${domain}">▶ Resume</button>
    </div>`).join('') + `</div>`;

  body.querySelectorAll('[data-resume]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await sendMsg({ type: 'RESUME_SITE', hostname: btn.dataset.resume });
      if (res) { appState = res.state; renderPausedSites(); toast(`▶ Resumed on ${btn.dataset.resume}`); }
    });
  });
}

// ── Full render ───────────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderCurrentCompanionCard();
  renderStoreGrid();    // re-render grid (selection state may change)
  renderConfig();
  renderHistory();
  renderPausedSites();
}

// ── Live countdown tick ───────────────────────────────────────────────────────
setInterval(() => {
  if (!appState) return;
  const wI  = appState.waterIntervalMs   ?? WATER_INTERVAL_DEFAULT_MS;
  const sI  = appState.stretchIntervalMs ?? STRETCH_INTERVAL_DEFAULT_MS;
  const wEl = document.getElementById('water-countdown');
  const sEl = document.getElementById('stretch-countdown');
  if (wEl) wEl.textContent = appState.pendingWater   ? 'Due now!' : fmtCountdown(appState.lastWaterTime,   wI);
  if (sEl) sEl.textContent = appState.pendingStretch ? 'Due now!' : fmtCountdown(appState.lastStretchTime, sI);
}, 5000);

// ── Select companion from store ───────────────────────────────────────────────
document.getElementById('select-companion-btn').addEventListener('click', async () => {
  if (!pickId) return;
  const chosen = filteredList.find(c => c.id === pickId);
  if (!chosen) return;
  if (appState?.companion && !confirm(`Switch to ${chosen.name}? Current progress will be lost.`)) return;

  const msgType = appState?.companion ? 'CHANGE_COMPANION' : 'SELECT_COMPANION';
  const res = await sendMsg({ type: msgType, companion: chosen });
  if (res) {
    appState = res.state;
    pickId   = null;
    renderAll();
    toast(`${chosen.name} is now your companion! 🎉`);
  }
});

// ── Search input ──────────────────────────────────────────────────────────────
document.getElementById('store-search').addEventListener('input', function () {
  searchQuery = this.value;
  applyFilters();
});

// ── Config sliders ────────────────────────────────────────────────────────────
document.getElementById('water-range').addEventListener('input', function () {
  document.getElementById('water-badge').textContent = `${this.value} min`;
});
document.getElementById('stretch-range').addEventListener('input', function () {
  document.getElementById('stretch-badge').textContent = `${this.value} min`;
});
document.getElementById('away-range').addEventListener('input', function () {
  document.getElementById('away-badge').textContent = `${this.value} min`;
});

// Widget size slider — syncs badge and preset highlight on drag
document.getElementById('size-range').addEventListener('input', function () {
  const px = parseInt(this.value, 10);
  document.getElementById('size-badge').textContent = `${px} px`;
  document.querySelectorAll('.size-preset-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.size) === px);
  });
});

// Build size preset buttons from VISUAL_SIZE_PRESETS (defined in shared.js)
function initSizePresets() {
  const container = document.getElementById('size-presets');
  VISUAL_SIZE_PRESETS.forEach(({ label, px }) => {
    const btn = document.createElement('button');
    btn.className      = 'size-preset-btn';
    btn.dataset.size   = px;
    btn.textContent    = label;
    btn.addEventListener('click', () => {
      document.getElementById('size-range').value = px;
      document.getElementById('size-badge').textContent = `${px} px`;
      document.querySelectorAll('.size-preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    container.appendChild(btn);
  });
}

document.getElementById('save-config-btn').addEventListener('click', async () => {
  const waterMin   = parseInt(document.getElementById('water-range').value,   10);
  const stretchMin = parseInt(document.getElementById('stretch-range').value, 10);
  const awayMin    = parseInt(document.getElementById('away-range').value,    10);
  const visualPx   = parseInt(document.getElementById('size-range').value,   10);
  const res = await sendMsg({
    type:              'SAVE_CONFIG',
    waterIntervalMs:   waterMin   * 60000,
    stretchIntervalMs: stretchMin * 60000,
    awayThresholdMs:   awayMin    * 60000,
    visualSize:        visualPx,
  });
  if (res) { appState = res.state; renderAll(); toast('✅ Saved!'); }
});

document.getElementById('reset-config-btn').addEventListener('click', async () => {
  const res = await sendMsg({
    type:              'SAVE_CONFIG',
    waterIntervalMs:   WATER_INTERVAL_DEFAULT_MS,
    stretchIntervalMs: STRETCH_INTERVAL_DEFAULT_MS,
    awayThresholdMs:   AWAY_THRESHOLD_DEFAULT_MS,
    visualSize:        VISUAL_SIZE_DEFAULT,
  });
  if (res) { appState = res.state; renderConfig(); toast('↩️ Defaults restored.'); }
});

// ── Reset actions ─────────────────────────────────────────────────────────────
document.getElementById('reset-stats-btn').addEventListener('click', async () => {
  if (!confirm('Reset all stat counters to zero? Companion and history are kept.')) return;
  const res = await sendMsg({ type: 'RESET_STATS' });
  if (res) { appState = res.state; renderAll(); toast('📊 Stats reset.'); }
});
document.getElementById('reset-all-btn').addEventListener('click', async () => {
  if (!confirm('⚠️ Permanently delete EVERYTHING — companion, stats, history, settings?\n\nThis cannot be undone.')) return;
  if (!confirm('Last chance. All data will be wiped. Continue?')) return;
  const res = await sendMsg({ type: 'RESET_ALL' });
  if (res) {
    appState = res.state;
    pickId   = null;
    renderAll();
    toast('🗑️ Everything reset.');
  }
});

// ── Storage live-sync ─────────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((_, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get(null, data => {
    appState = data;
    renderAll();
  });
});

// ── Re-render on context unfreeze ─────────────────────────────────────────────
function onContextUnfrozen() {
  chrome.storage.local.get(null, data => {
    appState = data;
    renderAll();
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) onContextUnfrozen(); });
window.addEventListener('focus',    onContextUnfrozen);
window.addEventListener('pageshow', onContextUnfrozen);

// ── Init ──────────────────────────────────────────────────────────────────────
(async function init() {
  initSizePresets();
  const { state } = await loadFromStorage();
  appState = state;
  renderAll();
  // Fetch companions from API in parallel — updates grid when ready
  loadCompanionsFromAPI();
})();
