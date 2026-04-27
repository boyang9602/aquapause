// Copyright 2026 Bo Yang
// Licensed under the PolyForm Strict License 1.0.0
// =============================================================================
// AquaPause — Widget logic
// Depends on shared.js. Uses state.companion directly (full API def stored there).
//
// Layout: two fixed zones stacked vertically.
//   ┌─────────────────────┐  ← WIDGET_PAD top
//   │      [up-zone]      │  ← sz × sz  (companion visual, never moves)
//   │      [dn-zone]      │  ← sz×1.25 wide, dnH tall (two timer icons)
//   └─────────────────────┘  ← WIDGET_PAD bottom
//
// The down-zone shows two standalone clickable icons (glass + battery) with
// countdown text. No button backgrounds — just the SVG icons themselves.
// =============================================================================
'use strict';

let appState       = null;
let countdownTimer = null;   // setInterval handle for live countdown refresh

// ── Layout constants ──────────────────────────────────────────────────────────
const WIDGET_PAD = 8;   // px padding around both zones (matches CSS)
const ZONE_GAP   = 4;   // px gap between up-zone and down-zone (matches CSS)

// ── Sizing helpers ────────────────────────────────────────────────────────────
function visualSz() { return appState?.visualSize ?? 70; }

// Font size scales with visualSize, clamped to [10, 16] px.
function scaledFont() {
  return Math.round(Math.min(Math.max(visualSz() * 0.17, 10), 16));
}

function widgetDims() {
  const sz    = visualSz();
  const sf    = scaledFont();
  const iconH = Math.round(sf * 2.4);          // icon height
  const dnH   = iconH + Math.round(sf) + 6;    // icon + text + gap
  const dnW   = Math.round(sz * 1.25);
  return {
    sz, sf, dnH, dnW, iconH,
    totalW: dnW + WIDGET_PAD * 2,
    totalH: sz  + ZONE_GAP + dnH + WIDGET_PAD * 2,
  };
}

// ── Size notification ─────────────────────────────────────────────────────────
function notifySize() {
  const { totalW, totalH } = widgetDims();
  window.parent.postMessage(
    { type: 'AQUAPAUSE_RESIZE', width: totalW + 4, height: totalH + 4 },
    '*'
  );
}

// ── Percentage helpers ────────────────────────────────────────────────────────
// Returns 1.0 at full/just-reset, 0.0 when due.
function getWaterPct() {
  if (appState?.pendingWater) return 0;
  const wI = appState?.waterIntervalMs ?? WATER_INTERVAL_DEFAULT_MS;
  const elapsed = Date.now() - (appState?.lastWaterTime ?? Date.now());
  return Math.max(0, Math.min(1, 1 - elapsed / wI));
}

function getStretchPct() {
  if (appState?.pendingStretch) return 0;
  const sI = appState?.stretchIntervalMs ?? STRETCH_INTERVAL_DEFAULT_MS;
  const elapsed = Date.now() - (appState?.lastStretchTime ?? Date.now());
  return Math.max(0, Math.min(1, 1 - elapsed / sI));
}

// ── Countdown helpers ─────────────────────────────────────────────────────────
function getWaterCountdown() {
  const wI = appState?.waterIntervalMs ?? WATER_INTERVAL_DEFAULT_MS;
  return appState?.pendingWater ? 'Now!' : fmtCountdown(appState?.lastWaterTime, wI);
}
function getStretchCountdown() {
  const sI = appState?.stretchIntervalMs ?? STRETCH_INTERVAL_DEFAULT_MS;
  return appState?.pendingStretch ? 'Now!' : fmtCountdown(appState?.lastStretchTime, sI);
}

// ── SVG builders — designed for white/light card background ──────────────────

/**
 * Water glass: vertical, blue outline, fill rises from bottom.
 * pct: 0..1  (1 = full, 0 = empty/due)
 * iconH: rendered height in px
 */
function buildWaterSVG(pct, iconH) {
  const H    = iconH;
  const W    = Math.round(H * 0.66);
  const wall = Math.max(1.8, Math.round(H * 0.07));
  const rimH = Math.max(2,   Math.round(H * 0.08));

  const ix   = wall;
  const iy   = rimH;
  const iw   = W - wall * 2;
  const ih   = H - rimH - wall;

  const fillH = Math.round(ih * Math.max(0, Math.min(1, pct)));
  const fillY = iy + ih - fillH;

  // Subtle wave on water surface
  const showWave = fillH > 3 && pct > 0.05;
  const waveY    = fillY + 1.5;
  const waveAmp  = Math.max(0.6, H * 0.04);
  const mid      = ix + iw / 2;
  const wavePath = showWave
    ? `<path d="M${ix} ${waveY} Q${mid-iw*0.25} ${waveY-waveAmp} ${mid} ${waveY} Q${mid+iw*0.25} ${waveY+waveAmp} ${ix+iw} ${waveY}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1"/>`
    : '';

  // Left-side shimmer
  const shimW = Math.max(1.5, iw * 0.2);
  const shimmer = fillH > 5
    ? `<rect x="${ix+1}" y="${fillY+2}" width="${shimW}" height="${Math.max(1,fillH-5)}" rx="${shimW/2}" fill="rgba(255,255,255,0.4)"/>`
    : '';

  return (
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">` +
      `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="1.5" fill="rgba(33,150,243,0.06)"/>` +
      (fillH > 0 ? `<rect x="${ix}" y="${fillY}" width="${iw}" height="${fillH}" rx="1.5" fill="rgba(33,150,243,0.55)"/>` : '') +
      wavePath + shimmer +
      `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="1.5" fill="none" stroke="rgba(25,118,210,0.7)" stroke-width="${wall}"/>` +
      `<line x1="0" y1="${rimH/2}" x2="${W}" y2="${rimH/2}" stroke="rgba(25,118,210,0.7)" stroke-width="${rimH}" stroke-linecap="round"/>` +
    `</svg>`
  );
}

/**
 * Battery: VERTICAL, terminal nub on top, fill rises from bottom.
 * Color: green > 50%, orange 10–50%, red < 10%.
 * Dark outlines — readable on white/light backgrounds.
 * pct: 0..1
 * iconH: rendered height in px
 */
function buildBatterySVG(pct, iconH) {
  const H      = iconH;
  const W      = Math.round(H * 0.5);
  const wall   = Math.max(1.8, Math.round(H * 0.07));

  // Terminal nub centered on top
  const termH  = Math.max(2, Math.round(H * 0.08));
  const termW  = Math.round(W * 0.38);
  const termX  = (W - termW) / 2;

  // Body below nub
  const bodyY  = termH;
  const bodyH  = H - termH;

  // Inner fill area
  const ix     = wall;
  const iy     = bodyY + wall;
  const iw     = W - wall * 2;
  const ih     = bodyH - wall * 2;

  // Fill rises from bottom
  const fillH  = Math.round(ih * Math.max(0, Math.min(1, pct)));
  const fillY  = iy + ih - fillH;

  // Color: green / orange / red (all readable on white)
  let fillColor;
  if      (pct > 0.5) fillColor = '#43a047';  // green
  else if (pct > 0.1) fillColor = '#fb8c00';  // orange
  else                fillColor = '#e53935';   // red

  // Top highlight stripe on fill
  const hlH = Math.round(ih * 0.25);
  const highlight = fillH > hlH + 2
    ? `<rect x="${ix}" y="${fillY}" width="${iw}" height="${Math.min(hlH, fillH)}" rx="1" fill="rgba(255,255,255,0.3)"/>`
    : '';

  return (
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">` +
      // Terminal nub
      `<rect x="${termX}" y="0" width="${termW}" height="${termH+1}" rx="1" fill="rgba(70,70,70,0.5)"/>` +
      // Body background
      `<rect x="0" y="${bodyY}" width="${W}" height="${bodyH}" rx="3" fill="rgba(0,0,0,0.04)"/>` +
      // Charge fill
      (fillH > 0 ? `<rect x="${ix}" y="${fillY}" width="${iw}" height="${fillH}" rx="2" fill="${fillColor}"/>` : '') +
      highlight +
      // Body outline
      `<rect x="0" y="${bodyY}" width="${W}" height="${bodyH}" rx="3" fill="none" stroke="rgba(60,60,60,0.45)" stroke-width="${wall}"/>` +
    `</svg>`
  );
}

// ── Button inner HTML (icon + countdown text) ─────────────────────────────────
function waterBtnHTML(iconH) {
  return buildWaterSVG(getWaterPct(), iconH) +
    `<span class="timer-val">${getWaterCountdown()}</span>`;
}
function stretchBtnHTML(iconH) {
  return buildBatterySVG(getStretchPct(), iconH) +
    `<span class="timer-val">${getStretchCountdown()}</span>`;
}

// ── Light refresh ─────────────────────────────────────────────────────────────
function refreshCountdowns() {
  const { iconH } = widgetDims();
  const wBtn = document.querySelector('.timer-btn.water');
  const sBtn = document.querySelector('.timer-btn.stretch');
  if (wBtn) wBtn.innerHTML = waterBtnHTML(iconH);
  if (sBtn) sBtn.innerHTML = stretchBtnHTML(iconH);
}

function startCountdownTimer() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(refreshCountdowns, 30_000);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  document.body.innerHTML = '';
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  if (!appState?.companion) { notifySize(); return; }
  renderWidget();
  startCountdownTimer();
  notifySize();
}

// ── Full widget ───────────────────────────────────────────────────────────────
function renderWidget() {
  const def = getCompDef(appState);
  if (!def) return;

  const { sz, sf, dnH, dnW, iconH, totalW, totalH } = widgetDims();
  const visual = getCompVisual(appState);

  // ── Widget shell ──────────────────────────────────────────────────────────
  const widget = document.createElement('div');
  widget.className = 'widget';
  widget.style.width  = `${totalW}px`;
  widget.style.height = `${totalH}px`;

  // ── Up zone ───────────────────────────────────────────────────────────────
  const upZone = document.createElement('div');
  upZone.className = 'up-zone';
  upZone.style.cssText = `width:${dnW}px; height:${sz}px;`;

  const closeBtn = document.createElement('button');
  closeBtn.className   = 'close-btn';
  closeBtn.title       = 'Close & pause on this site';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    window.parent.postMessage({ type: 'AQUAPAUSE_CLOSE' }, '*');
  });
  upZone.appendChild(closeBtn);

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

  // ── Down zone ─────────────────────────────────────────────────────────────
  const dnZone = document.createElement('div');
  dnZone.className = 'down-zone';
  dnZone.style.cssText = `width:${dnW}px; height:${dnH}px; font-size:${sf}px;`;

  const timerBtns = document.createElement('div');
  timerBtns.className = 'timer-btns';

  // Water icon button (transparent — icon is the visual)
  const waterBtn = document.createElement('button');
  waterBtn.className = `timer-btn water${appState.pendingWater ? ' due' : ''}`;
  waterBtn.title     = appState.pendingWater ? 'Mark as done' : 'Drink now & reset timer';
  waterBtn.innerHTML = waterBtnHTML(iconH);
  waterBtn.addEventListener('click', async () => {
    const type = appState.pendingWater ? 'WATER_DONE' : 'DRINK_NOW';
    const res = await sendMsg({ type });
    if (res) { appState = res.state; render(); }
  });

  // Stretch icon button
  const stretchBtn = document.createElement('button');
  stretchBtn.className = `timer-btn stretch${appState.pendingStretch ? ' due' : ''}`;
  stretchBtn.title     = appState.pendingStretch ? 'Mark as done' : 'Move now & reset timer';
  stretchBtn.innerHTML = stretchBtnHTML(iconH);
  stretchBtn.addEventListener('click', async () => {
    const type = appState.pendingStretch ? 'STRETCH_DONE' : 'MOVE_NOW';
    const res = await sendMsg({ type });
    if (res) { appState = res.state; render(); }
  });

  timerBtns.appendChild(waterBtn);
  timerBtns.appendChild(stretchBtn);
  dnZone.appendChild(timerBtns);
  widget.appendChild(dnZone);

  document.body.appendChild(widget);
}

// ── Storage changes → re-render ───────────────────────────────────────────────
chrome.storage.onChanged.addListener((_, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get(null, data => { appState = data; render(); });
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
