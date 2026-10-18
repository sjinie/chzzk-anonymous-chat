import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const source = await fs.readFile(new URL('../content.js', import.meta.url), 'utf8');
const channelId = 'e9c11510c1c6097a20b92ebcb289b26a';

class FakeElement {
  constructor(tagName, env) {
    this.tagName = tagName.toLowerCase();
    this.env = env;
    this.children = [];
    this.parentNode = null;
    this.style = {cssText: ''};
    this.listeners = new Map();
    this.attributes = new Map();
    this.isConnected = false;
    this.hidden = false;
    this._textContent = '';
    this.rect = null;
  }
  get textContent() { return this._textContent + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._textContent = String(value); }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode?.removeChild(node);
      node.parentNode = this;
      this.children.push(node);
      node.setConnected(this.isConnected);
      if (node.tagName === 'iframe') this.env.events.push('append:iframe');
    }
  }
  appendChild(node) { this.append(node); return node; }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i !== -1) this.children.splice(i, 1);
    node.parentNode = null;
    node.setConnected(false);
    return node;
  }
  remove() { this.parentNode?.removeChild(this); }
  setConnected(value) {
    this.isConnected = value;
    for (const child of this.children) child.setConnected(value);
    this.shadowRoot?.setConnected(value);
  }
  attachShadow() {
    const root = new FakeElement('#shadow-root', this.env);
    root.host = this;
    this.shadowRoot = root;
    return root;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(fn => fn !== listener));
  }
  dispatch(type) { for (const fn of [...(this.listeners.get(type) || [])]) fn({target: this}); }
  click() { this.dispatch('click'); }
  querySelectorAll(selector) {
    const all = [];
    const visit = node => {
      for (const child of node.children) {
        if (selector === 'button' && child.tagName === 'button') all.push(child);
        if (selector === 'option' && child.tagName === 'option') all.push(child);
        if (selector === 'h2,h3,[role="heading"]' && (['h2', 'h3'].includes(child.tagName) || child.getAttribute('role') === 'heading')) all.push(child);
        if (selector === '[role="log"]' && child.getAttribute('role') === 'log') all.push(child);
        visit(child);
      }
    };
    visit(this);
    return all;
  }
  querySelector(selector) {
    const id = selector.startsWith('#') ? selector.slice(1) : null;
    if (!id) return null;
    const visit = node => {
      if (node.id === id) return node;
      for (const child of node.children) { const found = visit(child); if (found) return found; }
      return null;
    };
    return visit(this);
  }
  getElementById(id) { return this.querySelector(`#${id}`); }
  getBoundingClientRect() {
    return this.rect || {left: 800, top: 100, right: 1200, width: 400, height: 600};
  }
}

class FakeIFrameElement extends FakeElement {
  constructor(env) {
    super('iframe', env);
    this._src = '';
    this.contentDocument = {
      head: new FakeElement('head', env),
      createElement: tagName => new FakeElement(tagName, env),
      getElementById(id) { return this.head.getElementById(id); }
    };
    this.contentWindow = {scrollCalls: [], scrollTo: (...args) => this.contentWindow.scrollCalls.push(args)};
  }
  set src(value) { this._src = String(value); this.env.events.push(`src:${this._src}`); }
  get src() { return this._src; }
}

function makePage({supported = true, pathname = `/live/${channelId}`, subframe = false} = {}) {
  const env = {
    events: [], iframes: [], observers: [], timeouts: new Map(), intervals: new Map(), nextTimer: 1,
    aside: null
  };
  const documentListeners = new Map();
  const windowListeners = new Map();
  const visualViewportListeners = new Map();
  const documentElement = new FakeElement('html', env);
  documentElement.setConnected(true);
  const document = {
    documentElement,
    createElement(tagName) {
      const element = tagName.toLowerCase() === 'iframe' ? new HTMLIFrameElement(env) : new FakeElement(tagName, env);
      if (element.tagName === 'iframe') env.iframes.push(element);
      return element;
    },
    querySelectorAll(selector) {
      if (!env.aside) return [];
      if (selector === 'aside') return env.aside.tagName === 'aside' ? [env.aside] : [];
      if (selector === 'aside, [role="complementary"]') {
        return env.aside.tagName === 'aside' || env.aside.getAttribute('role') === 'complementary' ? [env.aside] : [];
      }
      return [];
    },
    addEventListener(type, listener) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      documentListeners.set(type, (documentListeners.get(type) || []).filter(fn => fn !== listener));
    }
  };
  const window = {
    top: null,
    visualViewport: {
      width: 0, height: 0, offsetLeft: 0, offsetTop: 0,
      addEventListener(type, listener) {
        if (!visualViewportListeners.has(type)) visualViewportListeners.set(type, []);
        visualViewportListeners.get(type).push(listener);
      },
      removeEventListener(type, listener) {
        visualViewportListeners.set(type, (visualViewportListeners.get(type) || []).filter(fn => fn !== listener));
      },
      dispatch(type) { for (const fn of [...(visualViewportListeners.get(type) || [])]) fn({target: this}); }
    },
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      windowListeners.set(type, (windowListeners.get(type) || []).filter(fn => fn !== listener));
    },
    dispatch(type) { for (const fn of [...(windowListeners.get(type) || [])]) fn({target: this}); }
  };
  window.top = subframe ? {} : window;
  class HTMLIFrameElement extends FakeIFrameElement {}
  if (supported) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'credentialless', {
      configurable: true,
      get() { return this._credentialless; },
      set(value) { this._credentialless = value; env.events.push(`credentialless:${value}`); }
    });
  }
  class MutationObserver {
    constructor(callback) {
      this.kind = 'mutation'; this.callback = callback; this.disconnected = false; env.observers.push(this);
    }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
    trigger() { if (!this.disconnected) this.callback([]); }
  }
  class ResizeObserver {
    constructor(callback) {
      this.kind = 'resize'; this.callback = callback; this.disconnected = false;
      this.observed = new Set(); this.unobserved = []; env.observers.push(this);
    }
    observe(target) { this.observed.add(target); }
    unobserve(target) { this.observed.delete(target); this.unobserved.push(target); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    trigger() { if (!this.disconnected) this.callback([]); }
  }
  const runtimeListeners = [];
  const chrome = {runtime: {
    id: 'test-extension',
    getURL: path => `chrome-extension://test-extension/${path}`,
    onMessage: {
      addListener(listener) { runtimeListeners.push(listener); },
      removeListener(listener) {
        const index = runtimeListeners.indexOf(listener);
        if (index !== -1) runtimeListeners.splice(index, 1);
      }
    }
  }};
  const context = {
    window, document, location: {pathname}, HTMLIFrameElement, MutationObserver, ResizeObserver, chrome,
    innerWidth: 1280, innerHeight: 800,
    setTimeout(fn) { const id = env.nextTimer++; env.timeouts.set(id, fn); return id; },
    clearTimeout(id) { env.timeouts.delete(id); },
    setInterval(fn) { const id = env.nextTimer++; env.intervals.set(id, fn); return id; },
    clearInterval(id) { env.intervals.delete(id); }
  };
  vm.runInNewContext(source, context, {filename: fileURLToPath(new URL('../content.js', import.meta.url))});
  env.flushTimeouts = () => {
    const callbacks = [...env.timeouts.values()];
    env.timeouts.clear();
    for (const callback of callbacks) callback();
  };
  env.runtimeListeners = runtimeListeners;
  env.popupSender = {id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html')};
  env.sendControl = (action, overrides = {}) => {
    const message = {type: 'reader-control', action, ...(action === 'status' ? {} : {channelId}), ...overrides.message};
    let response;
    const sender = {...env.popupSender, ...overrides.sender};
    const accepted = runtimeListeners[0]?.(message, sender, value => { response = value; });
    return {accepted, response};
  };
  env.documentListeners = documentListeners;
  env.windowListeners = windowListeners;
  env.visualViewportListeners = visualViewportListeners;
  env.window = window;
  env.document = document;
  env.context = context;
  env.getHost = () => documentElement.children.find(node => node.id === 'chzzk-anonymous-reader');
  env.getRoot = () => env.getHost()?.shadowRoot;
  env.getFrame = () => env.iframes.at(-1);
  env.getButtons = () => env.getRoot()?.querySelectorAll('button') || [];
  env.enableReader = () => env.sendControl('enable').response;
  env.setAside = (rect, text = '') => {
    const aside = new FakeElement('aside', env);
    aside.rect = rect;
    if (text) aside.textContent = text;
    const heading = new FakeElement('h2', env);
    heading.textContent = '채팅';
    aside.append(heading);
    env.aside = aside;
    return aside;
  };
  env.resizeObserver = () => env.observers.find(observer => observer.kind === 'resize');
  env.mutationObserver = () => env.observers.find(observer => observer.kind === 'mutation');
  return env;
}

function panelRect(env) {
  const style = env.getRoot().querySelector('#panel').style;
  const number = key => Number.parseFloat(style[key]);
  const left = number('left'), top = number('top'), width = number('width'), height = number('height');
  return {left, top, right: left + width, bottom: top + height, width, height};
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function assertInside(rect, bounds, label) {
  assert.ok(rect.left >= bounds.left - 0.01, `${label}: left ${rect.left} is before ${bounds.left}`);
  assert.ok(rect.top >= bounds.top - 0.01, `${label}: top ${rect.top} is before ${bounds.top}`);
  assert.ok(rect.right <= bounds.right + 0.01, `${label}: right ${rect.right} is after ${bounds.right}`);
  assert.ok(rect.bottom <= bounds.bottom + 0.01, `${label}: bottom ${rect.bottom} is after ${bounds.bottom}`);
}

test('unrestricted live page has no injected host, panel, or button by default', () => {
  const env = makePage();
  assert.equal(env.getHost(), undefined);
  assert.deepEqual(env.getButtons(), []);
  const {response} = env.sendControl('status');
  assert.deepEqual(plain(response), {
    ok: true, supported: true, channelId, restricted: false, enabled: false,
    control: 'auto', mode: 'native', nativeSupported: true
  });
});

test('restricted chat guidance automatically activates the anonymous reader', () => {
  const env = makePage();
  assert.equal(env.getHost(), undefined);
  const aside = env.setAside({left: 800, top: 100, right: 1200, bottom: 700, width: 400, height: 600}, '채팅에 참여할 수 없습니다.');
  env.mutationObserver().trigger();
  env.flushTimeouts();

  const {response} = env.sendControl('status');
  assert.equal(response.restricted, true);
  assert.equal(response.enabled, true);
  assert.equal(response.control, 'auto');
  assert.ok(env.getHost(), 'restricted broadcasts should automatically mount the reader UI');
  assert.equal(env.getRoot().querySelector('#panel').hidden, false);
  assert.equal(env.resizeObserver().observed.has(aside), true);
});

test('activity-ban text inside ordinary live chat log does not trigger automatic activation', () => {
  const env = makePage();
  const aside = env.setAside({left: 800, top: 100, right: 1200, bottom: 700, width: 400, height: 600});
  const log = new FakeElement('div', env);
  log.setAttribute('role', 'log');
  log.textContent = '이 방송은 활동 제한 안내가 아니라 일반 시청자 메시지입니다.';
  aside.append(log);
  env.mutationObserver().trigger();
  env.flushTimeouts();

  const {response} = env.sendControl('status');
  assert.equal(response.restricted, false);
  assert.equal(response.enabled, false);
  assert.equal(response.control, 'auto');
  assert.equal(env.getHost(), undefined, 'ordinary chat messages must not mount a reader on unrestricted broadcasts');
});

test('popup status, enable, disable, and auto controls update only the current channel', () => {
  const env = makePage();
  assert.equal(env.sendControl('status').response.enabled, false);
  assert.equal(env.sendControl('enable').response.enabled, true);
  assert.equal(env.sendControl('enable').response.control, 'manual');
  assert.ok(env.getHost());
  assert.equal(env.sendControl('disable').response.enabled, false);
  assert.equal(env.sendControl('disable').response.control, 'manual');
  assert.equal(env.getRoot().querySelector('#panel').hidden, true);
  assert.equal(env.sendControl('auto').response.enabled, false);
  assert.equal(env.sendControl('auto').response.control, 'auto');
  assert.equal(env.getRoot().querySelector('#panel').hidden, true, 'automatic mode should leave the panel hidden on an unrestricted broadcast');
  assert.equal(env.getFrame().isConnected, false, 'automatic mode should leave no live frame on an unrestricted broadcast');
});

test('content controls reject unauthorized senders without changing page state', () => {
  const env = makePage();
  const wrongExtension = env.sendControl('enable', {sender: {id: 'other-extension'}});
  assert.equal(wrongExtension.accepted, false);
  assert.equal(wrongExtension.response, undefined);
  const wrongPage = env.sendControl('enable', {sender: {url: 'https://chzzk.naver.com/popup.html'}});
  assert.equal(wrongPage.accepted, false);
  assert.equal(wrongPage.response, undefined);
  assert.equal(env.getHost(), undefined);
});

test('content controls reject stale channel ids without enabling the reader', () => {
  const env = makePage();
  const {accepted, response} = env.sendControl('enable', {message: {channelId: '00000000000000000000000000000000'}});
  assert.equal(accepted, false);
  assert.deepEqual(plain(response), {ok: false, error: '방송이 변경되었습니다. 팝업을 다시 열어 주세요.'});
  assert.equal(env.getHost(), undefined);
  assert.equal(env.sendControl('status').response.enabled, false);
});

test('manifest keeps tab and cookie permissions absent and opens the popup from the action', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const permissions = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
  assert.equal(permissions.includes('tabs'), false);
  assert.equal(permissions.includes('cookies'), false);
  assert.equal(manifest.action?.default_popup, 'popup.html');
});

test('popup enable opens native CHZZK chat and sets credentialless before src and append', () => {
  const env = makePage();
  assert.equal(env.getRoot(), undefined, 'unrestricted pages should not mount UI before popup control');
  assert.deepEqual(plain(env.enableReader()), {
    ok: true, supported: true, channelId, restricted: false, enabled: true,
    control: 'manual', mode: 'native', nativeSupported: true
  });
  const root = env.getRoot();
  const select = root.querySelector('#mode');
  assert.equal(select.value, 'native');
  assert.equal(select.querySelectorAll('option').find(option => option.value === 'native')?.disabled, false);

  const frame = env.getFrame();
  assert.equal(frame.credentialless, true);
  assert.equal(frame.src, `https://chzzk.naver.com/live/${channelId}/chat`);
  const credentiallessAt = env.events.indexOf('credentialless:true');
  const srcAt = env.events.findIndex(event => event.startsWith('src:'));
  const appendAt = env.events.indexOf('append:iframe');
  assert.ok(credentiallessAt >= 0 && credentiallessAt < srcAt && srcAt < appendAt,
    `expected credentialless -> src -> append ordering, got ${env.events.join(' | ')}`);
});

test('popup enable uses the simple extension viewer when credentialless is unsupported', () => {
  const env = makePage({supported: false});
  assert.equal(env.getRoot(), undefined, 'unrestricted pages should not mount UI before popup control');
  env.enableReader();
  const root = env.getRoot();
  const select = root.querySelector('#mode');
  assert.equal(select.value, 'simple');
  assert.equal(select.querySelectorAll('option').find(option => option.value === 'native')?.disabled, true);

  assert.equal(env.getFrame().src, `chrome-extension://test-extension/viewer.html?channel=${channelId}`);
  assert.equal(env.events.some(event => event.startsWith('credentialless:')), false);
});

test('fallback panel stays inside compact and wide viewports', async t => {
  for (const [width, height] of [[320, 240], [300, 180], [1440, 900]]) {
    await t.test(`${width}x${height}`, () => {
      const env = makePage();
      env.context.innerWidth = width;
      env.context.innerHeight = height;
      env.enableReader();
      assertInside(panelRect(env), {left: 0, top: 0, right: width, bottom: height}, `${width}x${height}`);
      env.context.__chzzkAnonymousReader.dispose();
    });
  }
});

test('an existing aside is clipped to the viewport edges', () => {
  const env = makePage();
  env.context.innerWidth = 320;
  env.context.innerHeight = 240;
  const aside = env.setAside({left: -40, top: -20, right: 360, bottom: 300, width: 400, height: 320});
  env.mutationObserver().trigger();
  env.flushTimeouts();
  assert.equal(env.resizeObserver().observed.has(aside), true);
  env.enableReader();
  assert.deepEqual(panelRect(env), {left: 0, top: 0, right: 320, bottom: 240, width: 320, height: 240});
  env.context.__chzzkAnonymousReader.dispose();
});

test('window resize and visualViewport resize/offset events relayout the panel', () => {
  const env = makePage();
  env.enableReader();
  const initial = panelRect(env);

  env.context.innerWidth = 640;
  env.context.innerHeight = 400;
  env.window.dispatch('resize');
  const afterWindowResize = panelRect(env);
  assert.notDeepEqual(afterWindowResize, initial, 'window resize should recompute fallback geometry');
  assertInside(afterWindowResize, {left: 0, top: 0, right: 640, bottom: 400}, 'window resize');

  Object.assign(env.window.visualViewport, {width: 300, height: 200, offsetLeft: 20, offsetTop: 30});
  env.window.visualViewport.dispatch('resize');
  const afterVisualResize = panelRect(env);
  assertInside(afterVisualResize, {left: 20, top: 30, right: 320, bottom: 230}, 'visualViewport resize');
  assert.notDeepEqual(afterVisualResize, afterWindowResize);

  Object.assign(env.window.visualViewport, {offsetLeft: 80, offsetTop: 60});
  env.window.visualViewport.dispatch('scroll');
  const afterOffsetChange = panelRect(env);
  assertInside(afterOffsetChange, {left: 80, top: 60, right: 380, bottom: 260}, 'visualViewport offset change');
  assert.equal(afterOffsetChange.left, 92);
  assert.equal(afterOffsetChange.top, 72);
  env.context.__chzzkAnonymousReader.dispose();
});

test('ResizeObserver watches the original aside and toolbar and is disconnected on dispose', () => {
  const env = makePage();
  env.enableReader();
  const resizeObserver = env.resizeObserver();
  const bar = env.getRoot().querySelector('#bar');
  assert.ok(resizeObserver);
  assert.equal(resizeObserver.observed.has(bar), true, 'toolbar should be observed at creation');

  const aside = env.setAside({left: 800, top: 100, right: 1200, bottom: 700, width: 400, height: 600});
  env.mutationObserver().trigger();
  env.flushTimeouts();
  assert.equal(resizeObserver.observed.has(aside), true, 'original chat aside should be observed');

  env.context.__chzzkAnonymousReader.dispose();
  assert.equal(resizeObserver.disconnected, true);
  assert.equal(resizeObserver.observed.size, 0);
});

test('native iframe load installs bounded fit styles without overriding native log scrolling', () => {
  const env = makePage();
  env.enableReader();
  const frame = env.getFrame();
  assert.equal(frame.contentDocument.getElementById('chzzk-anonymous-reader-fit'), null);

  frame.dispatch('load');
  const fitStyle = frame.contentDocument.getElementById('chzzk-anonymous-reader-fit');
  assert.ok(fitStyle, 'native document load should install the fit stylesheet');
  const css = fitStyle.textContent;
  assert.match(css, /html,body,#root\{[^}]*min-width:0!important/,
    'native root should release fixed min-width');
  assert.match(css, /html,body,#root\{[^}]*height:100%!important/,
    'native root should use the iframe viewport height');
  assert.match(css, /html,body,#root\{[^}]*max-height:100%!important/);
  assert.match(css, /#aside-chatting\{[^}]*min-width:0!important/,
    'native chat container should release fixed min-width');
  assert.deepEqual(frame.contentWindow.scrollCalls, [[0, 0]], 'fit should reset the native document to its viewport origin');

  const overflowRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , declarations]) => /(?:^|;)\s*overflow\s*:/i.test(declarations))
    .map(([, selector]) => selector.trim());
  assert.deepEqual(overflowRules, ['html,body,#root'],
    'only the document/root boundary may clip; native descendant message scrollers must retain their own overflow behavior');
  frame.dispatch('load');
  assert.equal(frame.contentDocument.head.children.filter(node => node.id === 'chzzk-anonymous-reader-fit').length, 1,
    'repeated load should not duplicate the fit stylesheet');
  env.context.__chzzkAnonymousReader.dispose();
});

test('switching modes removes the old iframe before creating the replacement', () => {
  const env = makePage();
  env.enableReader();
  const root = env.getRoot();
  const nativeFrame = env.getFrame();
  assert.equal(nativeFrame.isConnected, true);

  const select = root.querySelector('#mode');
  select.value = 'simple';
  select.dispatch('change');
  const simpleFrame = env.getFrame();
  assert.notEqual(simpleFrame, nativeFrame);
  assert.equal(nativeFrame.isConnected, false);
  assert.equal(simpleFrame.isConnected, true);
  assert.equal(simpleFrame.src, `chrome-extension://test-extension/viewer.html?channel=${channelId}`);
  assert.equal(root.children.find(node => node.id === 'panel').children.filter(node => node.tagName === 'iframe').length, 1);
});

test('top-level /live/{id}/chat popup route does not mount or recurse', () => {
  const env = makePage({pathname: `/live/${channelId}/chat`});
  assert.equal(env.getHost(), undefined);
  assert.equal(env.iframes.length, 0);
  assert.equal(env.context.__chzzkAnonymousReader, undefined);
  assert.equal(env.observers.length, 0);
  assert.equal(env.intervals.size, 0);
});

test('content script exits in a subframe', () => {
  const env = makePage({subframe: true});
  assert.equal(env.getHost(), undefined);
  assert.equal(env.iframes.length, 0);
  assert.equal(env.observers.length, 0);
  assert.equal(env.intervals.size, 0);
  assert.equal(env.context.__chzzkAnonymousReader, undefined);
});

test('native close removes the iframe, popup enable reopens it, and dispose cleans up listeners and timers', () => {
  const env = makePage();
  env.enableReader();
  const root = env.getRoot();
  const firstFrame = env.getFrame();
  assert.equal(firstFrame.isConnected, true);

  const close = env.getButtons().find(button => button.textContent === '원래 채팅');
  assert.ok(close);
  close.click();
  assert.equal(firstFrame.isConnected, false);
  assert.equal(root.querySelector('#panel').hidden, true);

  env.enableReader();
  const reopenedFrame = env.getFrame();
  assert.notEqual(reopenedFrame, firstFrame);
  assert.equal(reopenedFrame.isConnected, true);

  const host = env.getHost();
  env.context.__chzzkAnonymousReader.dispose();
  assert.equal(reopenedFrame.isConnected, false);
  assert.equal(host.isConnected, false);
  assert.equal(env.document.documentElement.children.length, 0);
  assert.equal(env.observers.find(observer => observer.kind === 'mutation').disconnected, true);
  assert.equal(env.resizeObserver().disconnected, true);
  assert.equal(env.timeouts.size, 0);
  assert.equal(env.intervals.size, 0);
  assert.equal(env.windowListeners.get('resize')?.length || 0, 0);
  assert.equal(env.visualViewportListeners.get('resize')?.length || 0, 0);
  assert.equal(env.visualViewportListeners.get('scroll')?.length || 0, 0);
  assert.equal(env.documentListeners.get('fullscreenchange')?.length || 0, 0);
  assert.equal(env.context.__chzzkAnonymousReader, undefined);
});

test('route change tears down the native iframe and hides the injected UI', () => {
  const env = makePage();
  env.enableReader();
  const frame = env.getFrame();
  env.context.location.pathname = '/';
  env.mutationObserver().trigger();
  env.flushTimeouts();
  assert.equal(frame.isConnected, false);
  assert.equal(env.getHost(), undefined);
});
