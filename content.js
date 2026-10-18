(() => {
  'use strict';
  // Do not run in popup chats or subframes, including our native chat iframe.
  if (window.top !== window || globalThis.__chzzkAnonymousReader) return;
  if (/^\/live\/[a-f0-9]{32}\/chat\/?$/.test(location.pathname)) return;
  const lifecycle = globalThis.__chzzkAnonymousReader = {};
  const choices = new Map(), modes = new Map();
  const nativeSupported = 'credentialless' in HTMLIFrameElement.prototype;
  let channel = '', frame, aside, host, root, button, panel, select, timer, frameMode = '', observedAside;
  function channelFromURL() {
    return location.pathname.match(/^\/live\/([a-f0-9]{32})\/?$/)?.[1] || '';
  }
  function selectedMode() { return modes.get(channel) || (nativeSupported ? 'native' : 'simple'); }
  function create() {
    host = document.createElement('div'); host.id = 'chzzk-anonymous-reader';
    host.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;';
    root = host.attachShadow({mode: 'open'});
    const style = document.createElement('style');
    style.textContent = `:host{all:initial}*{box-sizing:border-box}button,select{font:600 12px system-ui,sans-serif;cursor:pointer}#toggle{position:fixed;right:20px;bottom:20px;pointer-events:auto;border:1px solid #346c5e;border-radius:24px;padding:12px 17px;color:#00ffa3;background:#182420;box-shadow:0 3px 18px #0007}#panel{position:fixed;pointer-events:auto;overflow:hidden;border:1px solid #303239;background:#141517;border-radius:8px;box-shadow:0 4px 24px #0005;display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0}#bar{height:40px;gap:8px;flex:none;display:flex;align-items:center;padding:0 8px 0 12px;background:#1d1f22;color:#e6e8eb;font:600 12px system-ui,sans-serif}#bar span{white-space:nowrap}#mode{min-width:0;flex:1;color:#00e596;background:#202a25;border:1px solid #3b5347;border-radius:5px;padding:4px}#bar button{white-space:nowrap;background:transparent;border:0;color:#c4c8ce;padding:6px}button:focus-visible,select:focus-visible{outline:2px solid #00e596;outline-offset:1px}iframe{display:block;box-sizing:border-box;border:0;width:100%;height:100%;min-width:0;min-height:0;background:#141517}[hidden]{display:none!important}`;
    panel = document.createElement('section'); panel.id = 'panel'; panel.hidden = true;
    panel.setAttribute('aria-label', '치지직 익명 채팅');
    const bar = document.createElement('div'); bar.id = 'bar';
    const title = document.createElement('span'); title.textContent = '익명 채팅';
    title.title = '메인 로그인은 유지하고, 이 창의 공개 채팅만 익명으로 봅니다.';
    select = document.createElement('select'); select.id = 'mode';
    select.setAttribute('aria-label', '채팅 표시 방식');
    for (const [value, text] of [['native', '기본 채팅'], ['simple', '간단 채팅']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text;
      if (value === 'native') option.disabled = !nativeSupported;
      select.append(option);
    }
    select.title = nativeSupported ? '기본 채팅: 닉네임 정보 카드 등 치지직 원래 UI. 문제 시 간단 채팅으로 전환하세요.' : '이 브라우저는 익명 iframe을 지원하지 않아 간단 채팅을 사용합니다.';
    select.addEventListener('change', () => { modes.set(channel, select.value); update(); });
    const close = document.createElement('button'); close.textContent = '원래 채팅'; close.title = '익명 연결을 종료하고 원래 채팅창 보기';
    close.addEventListener('click', () => { choices.set(channel, false); update(); });
    bar.append(title, select, close); panel.append(bar);
    sizeObserver?.observe(bar);
    button = document.createElement('button'); button.id = 'toggle'; button.textContent = '익명 채팅 보기';
    button.title = '로그인은 유지하고 공개 채팅만 익명으로 읽기';
    button.addEventListener('click', () => { choices.set(channel, true); update(); });
    root.append(style, panel, button); document.documentElement.append(host);
  }
  function findChat() {
    return [...document.querySelectorAll('aside, [role="complementary"]')].find(el =>
      !el.hasAttribute('aria-label') && [...el.querySelectorAll('h2,h3,[role="heading"]')].some(h => h.textContent.trim() === '채팅')) ||
      [...document.querySelectorAll('aside')].find(el => /활동 제한|채팅에 참여할 수 없/.test(el.textContent));
  }
  function viewportBounds() {
    const vv = window.visualViewport;
    const width = vv?.width > 0 ? vv.width : innerWidth;
    const height = vv?.height > 0 ? vv.height : innerHeight;
    const left = vv?.offsetLeft || 0, top = vv?.offsetTop || 0;
    return {left, top, right: left + width, bottom: top + height, width, height};
  }
  function layout() {
    if (!panel || panel.hidden) return;
    const v = viewportBounds(), rect = aside?.getBoundingClientRect();
    let left, top, right, bottom;
    if (rect && rect.width >= 120 && rect.height >= 80 &&
        rect.right > v.left && rect.left < v.right && rect.top < v.bottom &&
        (rect.bottom ?? rect.top + rect.height) > v.top) {
      left = Math.max(v.left, rect.left); top = Math.max(v.top, rect.top);
      right = Math.min(v.right, rect.right);
      bottom = Math.min(v.bottom, rect.bottom ?? rect.top + rect.height);
    } else {
      const gap = Math.min(12, v.width / 2, v.height / 2);
      const width = Math.min(360, Math.max(0, v.width - gap * 2));
      right = v.right - gap; left = right - width;
      top = v.top + Math.min(76, Math.max(gap, v.height - 200 - gap));
      bottom = v.bottom - gap;
    }
    Object.assign(panel.style, {
      left: left + 'px', top: top + 'px',
      width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px'
    });
    // Grid reserves the actual toolbar height. The iframe gets only the remaining row,
    // including after zoom, toolbar reflow, side-panel changes, or viewport resizing.
  }
  function fitNativeDocument(target) {
    if (target !== frame || frameMode !== 'native') return;
    try {
      const doc = target.contentDocument;
      if (!doc?.head || doc.getElementById('chzzk-anonymous-reader-fit')) return;
      const style = doc.createElement('style'); style.id = 'chzzk-anonymous-reader-fit';
      // Only the native popup document is adjusted. Keep the actual message scroller
      // and all native nickname/profile behavior intact. Never style the main page.
      style.textContent = `html,body,#root{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;height:100%!important;min-height:0!important;max-height:100%!important;overflow:hidden!important;margin:0!important}#root>div:has(#aside-chatting),#aside-chatting{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;height:100%!important;min-height:0!important;max-height:100%!important}#aside-chatting>*{min-width:0!important;max-width:100%!important;min-height:0!important}`;
      doc.head.append(style);
      target.contentWindow.scrollTo(0, 0);
    } catch { /* A cross-origin redirect must not be accessed or modified. */ }
  }
  function removeFrame() { frame?.remove(); frame = null; frameMode = ''; }
  function update() {
    const next = channelFromURL();
    if (!next) { sizeObserver?.disconnect(); observedAside = null; removeFrame(); host?.remove(); host = root = panel = button = select = null; channel = ''; return; }
    if (next !== channel) { removeFrame(); channel = next; }
    if (!host?.isConnected) { removeFrame(); create(); }
    aside = findChat();
    if (observedAside !== aside) {
      if (observedAside) sizeObserver?.unobserve(observedAside);
      observedAside = aside;
      if (aside) sizeObserver?.observe(aside);
    }
    const restricted = !!aside && /활동 제한|채팅에 참여할 수 없/.test(aside.textContent);
    const enabled = choices.has(channel) ? choices.get(channel) : restricted;
    const mode = selectedMode(); select.value = mode;
    panel.hidden = !enabled; button.hidden = enabled;
    if (frame && (!enabled || frameMode !== mode)) removeFrame();
    if (enabled && !frame) {
      frame = document.createElement('iframe'); frame.referrerPolicy = 'no-referrer';
      if (mode === 'native') {
        // Set before src and DOM insertion. A regular iframe would reuse the banned login.
        // Embed directly below chzzk.naver.com, not inside an extension-origin iframe:
        // CHZZK's frame-ancestors policy permits its own origin, not chrome-extension://.
        frame.credentialless = true;
        const target = frame;
        frame.addEventListener('load', () => fitNativeDocument(target));
        frame.title = '치지직 기본 채팅 · 익명';
        frame.src = `https://chzzk.naver.com/live/${channel}/chat`;
      } else {
        frame.title = '익명 간단 채팅 · 읽기 전용';
        frame.src = chrome.runtime.getURL('viewer.html') + '?channel=' + channel;
      }
      frameMode = mode; panel.append(frame);
    }
    layout();
  }
  const sizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(update, 150); });
  observer.observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener('resize', layout, {passive: true});
  document.addEventListener('fullscreenchange', layout);
  window.visualViewport?.addEventListener('resize', layout, {passive: true});
  window.visualViewport?.addEventListener('scroll', layout, {passive: true});
  const interval = setInterval(update, 1200);
  lifecycle.dispose = () => {
    observer.disconnect(); sizeObserver?.disconnect(); clearTimeout(timer); clearInterval(interval);
    window.removeEventListener('resize', layout);
    document.removeEventListener('fullscreenchange', layout);
    window.visualViewport?.removeEventListener('resize', layout);
    window.visualViewport?.removeEventListener('scroll', layout);
    removeFrame(); host?.remove();
    delete globalThis.__chzzkAnonymousReader;
  };
  update();
})();
