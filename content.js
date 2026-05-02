// Copyright 2026 Bo Yang
// Licensed under the PolyForm Strict License 1.0.0
// =============================================================================
// AquaPause — Content Script
// Injects the widget iframe only on non-paused sites.
// =============================================================================
(function () {
  'use strict';

  if (window.self !== window.top) return;

  if (window.__aquapauseAbort) window.__aquapauseAbort.abort();
  const abortCtrl = new AbortController();
  const sig       = abortCtrl.signal;
  window.__aquapauseAbort = abortCtrl;

  const currentHostname = window.location.hostname;

  // ── Messaging ────────────────────────────────────────────────────────────────
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

  // ── Teardown ──────────────────────────────────────────────────────────────────
  function teardown() {
    document.getElementById('aquapause-iframe')?.remove();
    document.getElementById('aquapause-iframe-style')?.remove();
  }

  teardown();

  // ── Injection ─────────────────────────────────────────────────────────────────
  let iframe        = null;
  let missedPings   = 0;
  let injected      = false;
  let livenessTimer = null;

  function inject(visualSize = 70) {
    if (injected) return;
    injected = true;

    iframe = document.createElement('iframe');
    iframe.id = 'aquapause-iframe';
    iframe.src = chrome.runtime.getURL('widget.html');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('loading', 'eager');

    const iframeStyle = document.createElement('style');
    iframeStyle.id = 'aquapause-iframe-style';
    iframeStyle.textContent = `
      #aquapause-iframe {
        position:     fixed         !important;
        bottom:       20px          !important;
        right:        20px          !important;
        top:          auto          !important;
        left:         auto          !important;
        border:       none          !important;
        background:   transparent   !important;
        z-index:      2147483647    !important;
        color-scheme: normal        !important;
        will-change:  transform     !important;
        transform:    translateZ(0) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(iframeStyle);

    function setIframeSize(w, h) {
      if (!iframe?.style) return;
      iframe.style.width  = w + 'px';
      iframe.style.height = h + 'px';
    }

    // Derive the initial iframe width the same way widget.js does so the first
    // paint already has the correct size without waiting for AQUAPAUSE_RESIZE.
    const initW = Math.max(Math.round(visualSize * 1.25), 110) + 8;
    setIframeSize(initW, 180);

    // Track whether the iframe is currently in centred (intrusive) mode so we
    // can revert the style block cleanly on dismiss.
    let isCentred = false;

    function setCentred(w, h) {
      if (!iframe?.style) return;
      iframe.style.width  = w + 'px';
      iframe.style.height = h + 'px';
      iframe.style.setProperty('bottom',    'auto',                               'important');
      iframe.style.setProperty('right',     'auto',                               'important');
      iframe.style.setProperty('top',       '50%',                                'important');
      iframe.style.setProperty('left',      '50%',                                'important');
      iframe.style.setProperty('transform', 'translate(-50%, -50%) translateZ(0)','important');
      isCentred = true;
    }

    function setCorner() {
      if (!iframe?.style) return;
      iframe.style.removeProperty('bottom');
      iframe.style.removeProperty('right');
      iframe.style.removeProperty('top');
      iframe.style.removeProperty('left');
      iframe.style.removeProperty('transform');
      isCentred = false;
    }

    window.addEventListener('message', e => {
      if (e.data?.type === 'AQUAPAUSE_RESIZE') {
        const w = e.data.width  || initW;
        const h = e.data.height || 180;
        if (e.data.centre) {
          setCentred(w, h);
        } else {
          if (isCentred) setCorner();
          setIframeSize(w, h);
        }
      }
      if (e.data?.type === 'AQUAPAUSE_PONG') missedPings = 0;
      if (e.data?.type === 'AQUAPAUSE_CLOSE') {
        sendMsg({ type: 'PAUSE_SITE', hostname: currentHostname });
        eject();
      }
      if (e.data?.type === 'AQUAPAUSE_INTRUSIVE_DISMISS') {
        setCorner();
        // Restore the normal widget size (widget.js will call notifySize on its
        // own re-render, but snapping the size immediately avoids a flash).
        setIframeSize(initW, 180);
        // Tell the widget iframe it can now render the normal corner widget.
        try { iframe?.contentWindow?.postMessage({ type: 'AQUAPAUSE_INTRUSIVE_DISMISSED' }, '*'); } catch {}
      }
    }, { signal: sig });

    livenessTimer = setInterval(() => {
      if (sig.aborted) { clearInterval(livenessTimer); livenessTimer = null; return; }
      try { iframe?.contentWindow?.postMessage({ type: 'AQUAPAUSE_PING' }, '*'); } catch {}
      setTimeout(() => {
        if (sig.aborted || !iframe) return;
        missedPings++;
        if (missedPings >= 3) {
          missedPings = 0;
          iframe.src = chrome.runtime.getURL('widget.html');
        }
      }, 5000);
    }, 30000);

    document.documentElement.appendChild(iframe);
  }

  // ── Eject ─────────────────────────────────────────────────────────────────────
  function eject() {
    if (livenessTimer) { clearInterval(livenessTimer); livenessTimer = null; }
    document.getElementById('aquapause-iframe')?.remove();
    document.getElementById('aquapause-iframe-style')?.remove();
    iframe   = null;
    injected = false;
  }

  // ── Storage changes ───────────────────────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (sig.aborted || area !== 'local') return;
    chrome.storage.local.get(null, data => {
      const nowPaused = (data.pausedDomains ?? []).includes(currentHostname);

      if (nowPaused && injected) {
        eject();
      } else if (!nowPaused && !injected && data.companion) {
        inject(data.visualSize ?? 70);
      }

      // Forward sync to widget iframe
      if (iframe) {
        try { iframe.contentWindow?.postMessage({ type: 'AQUAPAUSE_SYNC' }, '*'); } catch {}
      }
    });
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  chrome.storage.local.get(null, data => {
    const isPaused = (data.pausedDomains ?? []).includes(currentHostname);
    if (!isPaused && data.companion) inject(data.visualSize ?? 70);
  });

})();
