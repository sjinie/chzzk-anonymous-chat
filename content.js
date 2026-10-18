(() => {
  'use strict';
  if (globalThis.__chzzkAnonymousReader) return;
  globalThis.__chzzkAnonymousReader = true;
  const choices = new Map();
  let channel = '', frame, aside, host, root, button, panel, timer;
  function channelFromURL() {
    return location.pathname.match(/^\/live\/([a-f0-9]{32})(?:\/|$)/)?.[1] || '';
  }
  function create() {
    host = document.createElement('div'); host.id = 'chzzk-anonymous-reader';
    host.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;';
    root = host.attachShadow({mode: 'open'});
    const style = document.createElement('style');
    style.textContent = `:host{all:initial}*{box-sizing:border-box}button{font:600 13px system-ui,sans-serif;cursor:pointer}#toggle{position:fixed;right:20px;bottom:20px;pointer-events:auto;border:1px solid #346c5e;border-radius:24px;padding:12px 17px;color:#00ffa3;background:#182420;box-shadow:0 3px 18px #0007}#panel{position:fixed;pointer-events:auto;overflow:hidden;border:1px solid #303239;background:#141517;border-radius:8px;box-shadow:0 4px 24px #0005;display:flex;flex-direction:column}#bar{height:38px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 10px 0 14px;background:#1d1f22;color:#e6e8eb;font:600 12px system-ui,sans-serif}#bar button{background:transparent;border:0;color:#c4c8ce;padding:6px}iframe{border:0;width:100%;flex:1;min-height:0}[hidden]{display:none!important}`;
    panel = document.createElement('section'); panel.id = 'panel'; panel.hidden = true;
    panel.setAttribute('aria-label', '치지직 익명 읽기 전용 채팅');
    const bar = document.createElement('div'); bar.id = 'bar';
    const title = document.createElement('span'); title.textContent = '익명 채팅 뷰어';
    const close = document.createElement('button'); close.textContent = '원래 채팅'; close.title = '익명 연결을 종료하고 원래 채팅창 보기';
    close.addEventListener('click', () => { choices.set(channel, false); update(); });
    bar.append(title, close); panel.append(bar);
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
  function layout() {
    if (!panel || panel.hidden) return;
    const rect = aside?.getBoundingClientRect();
    if (rect && rect.width >= 220 && rect.height >= 240 && rect.right > 0 && rect.left < innerWidth) {
      Object.assign(panel.style, {left: `${Math.max(0, rect.left)}px`, top: `${Math.max(0, rect.top)}px`,
        width: `${Math.min(rect.width, innerWidth)}px`, height: `${Math.min(rect.height, innerHeight - Math.max(0, rect.top))}px`});
    } else {
      const width = Math.min(360, innerWidth - 24), height = Math.max(240, innerHeight - 100);
      Object.assign(panel.style, {left: `${Math.max(12, innerWidth - width - 12)}px`, top: '76px', width: `${width}px`, height: `${height}px`});
    }
  }
  function update() {
    const next = channelFromURL();
    if (!next) { host?.remove(); host = root = panel = button = frame = null; channel = ''; return; }
    if (next !== channel) { frame?.remove(); frame = null; channel = next; }
    if (!host?.isConnected) create();
    aside = findChat();
    const restricted = !!aside && /활동 제한|채팅에 참여할 수 없/.test(aside.textContent);
    const enabled = choices.has(channel) ? choices.get(channel) : restricted;
    panel.hidden = !enabled; button.hidden = enabled;
    if (enabled && !frame) {
      frame = document.createElement('iframe'); frame.title = '익명 공개 채팅 · 읽기 전용';
      frame.referrerPolicy = 'no-referrer';
      frame.src = chrome.runtime.getURL('viewer.html') + '?channel=' + channel;
      panel.append(frame);
    } else if (!enabled && frame) { frame.remove(); frame = null; }
    layout();
  }
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(update, 150); });
  observer.observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener('resize', layout, {passive: true});
  document.addEventListener('fullscreenchange', layout);
  setInterval(update, 1200); // Also handles SPA route changes and chat folding.
  update();
})();
