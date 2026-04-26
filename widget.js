// =============================================================================
// AquaPause — Widget logic
// Depends on shared.js. Uses state.companion directly (full API def stored there).
//
// Layout: two fixed zones stacked vertically.
//   ┌─────────────────────┐  ← WIDGET_PAD top
//   │      [up-zone]      │  ← sz × sz  (companion visual, never moves)
//   │      [dn-zone]      │  ← sz×1.25 wide, sz/3 tall (buttons or panel)
//   └─────────────────────┘  ← WIDGET_PAD bottom
//
// Dimensions are computed from visualSize and never change for a given size,
// so the visual never jumps when the down-zone content swaps.
// =============================================================================
'use strict';

let appState        = null;
let awaitingStretch = false;

// ── Layout constants ──────────────────────────────────────────────────────────
const WIDGET_PAD = 8;   // px padding around both zones (matches CSS)
const ZONE_GAP   = 4;   // px gap between up-zone and down-zone (matches CSS)

// ── Sizing helpers ────────────────────────────────────────────────────────────
function visualSz() { return appState?.visualSize ?? 70; }

function widgetDims() {
  const sz  = visualSz();
  const dnH = Math.round(sz / 2);
  const dnW = Math.round(sz * 1.25);
  return {
    sz,
    dnH,
    dnW,
    totalW: dnW + WIDGET_PAD * 2,
    totalH: sz  + ZONE_GAP + dnH + WIDGET_PAD * 2,
  };
}

// ── Size notification ─────────────────────────────────────────────────────────
// Dimensions are fully determined by visualSize — no DOM measurement needed.
// +4 gives a 2 px buffer on each axis so bob/pulse animations never clip.
function notifySize() {
  const { totalW, totalH } = widgetDims();
  window.parent.postMessage(
    { type: 'AQUAPAUSE_RESIZE', width: totalW + 4, height: totalH + 4 },
    '*'
  );
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  document.body.innerHTML = '';
  if (!appState?.companion) { notifySize(); return; }
  renderWidget();
  notifySize();
}

// ── Full widget ───────────────────────────────────────────────────────────────
function renderWidget() {
  const def = getCompDef(appState);
  if (!def) return;

  const { sz, dnH, dnW, totalW, totalH } = widgetDims();
  const visual      = getCompVisual(appState);
  const hasPending  = (appState.pendingWater && !awaitingStretch)
                   || awaitingStretch
                   || (!appState.pendingWater && appState.pendingStretch);
  const showWater   = appState.pendingWater && !awaitingStretch;
  const showStretch = awaitingStretch || (!appState.pendingWater && appState.pendingStretch);
  const showBloom   = def.type === 'plant' && appState.plantBloomed
                   && !showWater && !showStretch;

  // ── Widget shell ──────────────────────────────────────────────────────────────
  const widget = document.createElement('div');
  widget.className = `widget${hasPending ? ' alert' : ''}`;
  widget.style.width  = `${totalW}px`;
  widget.style.height = `${totalH}px`;

  // ── Up zone (companion visual — position never changes) ────────────────────
  const upZone = document.createElement('div');
  upZone.className = 'up-zone';
  upZone.style.cssText = `width:${dnW}px; height:${sz}px;`;

  // Close button — positioned absolute inside up-zone
  const closeBtn = document.createElement('button');
  closeBtn.className   = 'close-btn';
  closeBtn.title       = 'Close & pause on this site';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    window.parent.postMessage({ type: 'AQUAPAUSE_CLOSE' }, '*');
  });
  upZone.appendChild(closeBtn);

  // Companion image — 4 px inset from zone edges so bob/pulse fits inside
  const visualWrap = document.createElement('div');
  visualWrap.className = 'comp-visual';
  visualWrap.title     = 'Open settings';
  const visualInner = document.createElement('div');
  visualInner.className = 'comp-visual-inner';
  const imgEl = buildVisualEl(visual, sz - 4);
  if (imgEl) visualInner.appendChild(imgEl);
  visualWrap.appendChild(visualInner);
  visualWrap.addEventListener('click', () => chrome.runtime.openOptionsPage());
  upZone.appendChild(visualWrap);

  widget.appendChild(upZone);

  // ── Down zone (swappable content — fixed size so up-zone stays put) ────────
  const dnZone = document.createElement('div');
  dnZone.className = 'down-zone';
  dnZone.style.cssText = `width:${dnW}px; height:${dnH}px;`;

  if (showWater) {
    const panel = document.createElement('div');
    panel.className = 'reminder-panel';
    panel.innerHTML = `
      <div class="reminder-heading">💧 ${getWaterMessage(appState)}</div>
      <button class="action-btn water" id="water-btn">Done, I drank! 💧</button>`;
    dnZone.appendChild(panel);
  } else if (showStretch) {
    const panel = document.createElement('div');
    panel.className = 'reminder-panel';
    panel.innerHTML = `
      <div class="reminder-heading">🚶 ${getMoveMessage(appState)}</div>
      <button class="action-btn stretch" id="stretch-btn">Done! 🌿</button>`;
    dnZone.appendChild(panel);
  } else if (showBloom) {
    const bloom = document.createElement('div');
    bloom.className = 'bloom-banner';
    bloom.innerHTML = `<button class="new-seed-btn" id="new-seed-btn">🌱 Plant new seed</button>`;
    dnZone.appendChild(bloom);
  } else {
    const btns = document.createElement('div');
    btns.className = 'quick-btns';
    btns.innerHTML = `
      <button class="quick-btn water"   id="drink-now-btn">💧 Drink</button>
      <button class="quick-btn stretch" id="move-now-btn">🚶 Move</button>`;
    dnZone.appendChild(btns);
  }

  widget.appendChild(dnZone);

  // ── Event wiring ──────────────────────────────────────────────────────────────
  widget.querySelector('#new-seed-btn')?.addEventListener('click', async () => {
    const res = await sendMsg({ type: 'NEW_SEED' });
    if (res) { appState = res.state; render(); }
  });
  widget.querySelector('#drink-now-btn')?.addEventListener('click', async () => {
    const res = await sendMsg({ type: 'DRINK_NOW' });
    if (res) { appState = res.state; awaitingStretch = false; render(); }
  });
  widget.querySelector('#move-now-btn')?.addEventListener('click', async () => {
    const res = await sendMsg({ type: 'MOVE_NOW' });
    if (res) { appState = res.state; render(); }
  });
  widget.querySelector('#water-btn')?.addEventListener('click', async () => {
    const res = await sendMsg({ type: 'WATER_DONE' });
    if (res) { appState = res.state; awaitingStretch = !!appState.pendingStretch; render(); }
  });
  widget.querySelector('#stretch-btn')?.addEventListener('click', async () => {
    const res = await sendMsg({ type: 'STRETCH_DONE' });
    if (res) { appState = res.state; awaitingStretch = false; render(); }
  });

  document.body.appendChild(widget);
}

// ── Storage changes → re-render ───────────────────────────────────────────────
chrome.storage.onChanged.addListener((_, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get(null, data => {
    appState = data;
    render();
  });
});

// ── Re-render on context unfreeze ─────────────────────────────────────────────
function onContextUnfrozen() {
  chrome.storage.local.get(null, data => { appState = data; render(); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) onContextUnfrozen(); });
window.addEventListener('focus',    onContextUnfrozen);
window.addEventListener('pageshow', onContextUnfrozen);

// ── Messages from content.js ──────────────────────────────────────────────────
window.addEventListener('message', e => {
  if (e.data?.type === 'AQUAPAUSE_PING')
    window.parent.postMessage({ type: 'AQUAPAUSE_PONG' }, '*');
  if (e.data?.type === 'AQUAPAUSE_SYNC') {
    chrome.storage.local.get(null, data => { appState = data; render(); });
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  const { state } = await loadFromStorage();
  appState = state;
  render();
});
