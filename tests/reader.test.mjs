import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {ChatClient, parseChat, socketURL} from '../chat-client.mjs';
const base = new URL('../', import.meta.url);
const source = await fs.readFile(new URL('background.js', base), 'utf8');
const channelId = 'e9c11510c1c6097a20b92ebcb289b26a';
const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const sender = {id: extensionId, url: `chrome-extension://${extensionId}/viewer.html?channel=${channelId}`};
export function broker(fetchImpl = fetch, ruleError = false) {
  let listener; const rules = [];
  const chrome = {
    runtime: {id: extensionId, getURL: p => `chrome-extension://${extensionId}/${p.replace(/^\//, '')}`,
      onMessage: {addListener: fn => { listener = fn; }}},
    declarativeNetRequest: {updateSessionRules: async rule => { rules.push(rule); if (ruleError) throw new Error('denied'); }}
  };
  vm.runInNewContext(source, {chrome, fetch: fetchImpl, URL, URLSearchParams, AbortSignal, Error});
  return {
    rules,
    call(message, from = sender) {
      return new Promise(resolve => { const result = listener(message, from, resolve); if (result === false) resolve(undefined); });
    }
  };
}
const fakeFetch = calls => async (url, options) => {
  calls.push({url: String(url), options});
  return {ok: true, json: async () => ({code: 200, content: String(url).includes('access-token') ? {accessToken: 'test-only-token'} :
    {status: 'OPEN', chatChannelId: 'N2oRVC', liveTitle: 'test', chatActive: true}})};
};
class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.sent = []; this.readyState = 0; FakeSocket.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(frame) { this.onmessage?.({data: typeof frame === 'string' ? frame : JSON.stringify(frame)}); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function makeClient(overrides = {}) {
  const events = {statuses: [], messages: [], notices: [], moderations: []};
  const client = new ChatClient({
    request: async () => ({ok: true, status: 'OPEN', chatActive: true, chatChannelId: 'N2oRVC', accessToken: 'test-only-token'}),
    status: x => events.statuses.push(x), messages: x => events.messages.push(...x),
    notice: x => events.notices.push(x), moderation: x => events.moderations.push(x),
    WebSocketImpl: FakeSocket, ...overrides
  });
  return {client, events};
}
test('Manifest: MV3, no cookies/tabs/history permissions, required files exist', async () => {
  const m = JSON.parse(await fs.readFile(new URL('manifest.json', base), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, ['declarativeNetRequestWithHostAccess']);
  assert(m.host_permissions.includes('wss://*.chat.naver.com/*'));
  for (const file of [m.background.service_worker, ...m.content_scripts[0].js, ...m.web_accessible_resources[0].resources])
    await fs.access(new URL(file, base));
});
test('Anonymous HTTP: fixed GET endpoints omit credentials and reject redirects', async () => {
  const calls = []; const b = broker(fakeFetch(calls));
  const result = await b.call({type: 'prepare', channelId});
  assert.equal(result.ok, true); assert.equal(calls.length, 2);
  for (const c of calls) { assert.equal(c.options.credentials, 'omit'); assert.equal(c.options.method, 'GET'); assert.equal(c.options.redirect, 'error'); }
  assert.equal(b.rules.length, 1);
  const rule = b.rules[0].addRules[0];
  assert.equal(rule.condition.initiatorDomains[0], extensionId);
  assert.equal(rule.condition.resourceTypes[0], 'websocket');
  assert.equal(rule.action.requestHeaders[0].header, 'cookie');
  assert.equal(rule.action.responseHeaders[0].header, 'set-cookie');
  assert(new RegExp(rule.condition.regexFilter).test('wss://kr-ss9.chat.naver.com/chat'));
  assert(!new RegExp(rule.condition.regexFilter).test('wss://attacker.example/chat'));
});
test('Fail closed: failed cookie-removal rule prevents token request', async () => {
  const calls = []; const b = broker(fakeFetch(calls), true);
  const result = await b.call({type: 'prepare', channelId});
  assert.equal(result.ok, false); assert.equal(calls.length, 1);
});
test('API broker rejects website senders, arbitrary URLs, and writing operations', async () => {
  const calls = []; const b = broker(fakeFetch(calls));
  assert.equal(await b.call({type: 'prepare', channelId}, {id: extensionId, url: 'https://chzzk.naver.com/'}), undefined);
  assert.equal(await b.call({type: 'prepare', channelId: '../user'}), undefined);
  assert.equal(await b.call({type: 'send', channelId}), undefined);
  assert.equal(calls.length, 0);
});
test('Status polling never requests a token or installs socket rules', async () => {
  const calls = []; const b = broker(fakeFetch(calls));
  assert.equal((await b.call({type: 'status', channelId})).ok, true);
  assert.equal(calls.length, 1); assert.equal(b.rules.length, 0);
});
test('Message parser supports recent/live fields, malformed profile, hidden messages', () => {
  const a = parseChat({userId: 'a', messageTime: 3, content: '<script>test</script>', messageTypeCode: 1, messageStatusType: 'HIDDEN', profile: '{oops'});
  assert.equal(a.uid, 'a'); assert.equal(a.time, 3); assert.equal(a.hidden, true); assert.equal(a.nickname, '익명');
  assert.equal(a.text, '<script>test</script>');
  assert.equal(parseChat({uid: 'a', msgTime: 3, msg: a.text}).key, a.key);
});
test('WebSocket server selection matches public protocol', () => {
  assert.equal(socketURL('N2oRVC'), 'wss://kr-ss7.chat.naver.com/chat');
});
test('Protocol: anonymous READ handshake, recent request, ping/pong, rendering and stop', async () => {
  const {client, events} = makeClient();
  try {
    client.start(channelId); await tick(); const ws = FakeSocket.instances.at(-1); ws.open();
    assert.equal(ws.sent[0].cmd, 100); assert.equal(ws.sent[0].bdy.auth, 'READ'); assert.equal(ws.sent[0].bdy.uid, null);
    ws.message({cmd: 10100, retCode: 0, bdy: {sid: 'test-session'}});
    assert.equal(events.statuses.at(-1).state, 'connected'); assert.equal(ws.sent.at(-1).cmd, 5101);
    ws.message({cmd: 0}); assert.equal(ws.sent.at(-1).cmd, 10000);
    ws.message('{invalid');
    ws.message({cmd: 15101, bdy: {messageList: [{content: 'recent', messageTypeCode: 1, messageTime: 1}]}});
    ws.message({cmd: 93101, bdy: [{msg: 'live', msgTime: 2, profile: JSON.stringify({nickname: 'viewer'})}]});
    assert.deepEqual(events.messages.map(m => m.text), ['recent', 'live']);
    ws.message({cmd: 94008, bdy: {messageTime: 2, userId: 'a'}}); assert.equal(events.moderations.length, 1);
    assert.throws(() => client.send({cmd: 3101, bdy: {msg: 'NEVER SENT'}}), /읽기 전용/);
    assert(ws.sent.every(frame => [0, 100, 5101, 10000].includes(frame.cmd)));
    client.stop(); assert.equal(ws.readyState, 3); assert.equal(client.active, false);
  } finally { client.stop(); }
});
test('Offline channel does not create a WebSocket', async () => {
  const {client, events} = makeClient({request: async () => ({ok: true, status: 'CLOSE'})});
  const before = FakeSocket.instances.length;
  try { client.start(channelId); await tick(); assert.equal(FakeSocket.instances.length, before); assert.equal(events.statuses.at(-1).state, 'waiting'); }
  finally { client.stop(); }
});
test('A late API result cannot reconnect after the viewer is closed', async () => {
  let resolve; const {client} = makeClient({request: () => new Promise(r => {resolve = r;})});
  const before = FakeSocket.instances.length; client.start(channelId); client.stop();
  resolve({ok: true, status: 'OPEN', chatActive: true, chatChannelId: 'old', accessToken: 'test'}); await tick();
  assert.equal(FakeSocket.instances.length, before);
});
test('Server rejection closes the socket and schedules a bounded retry', async () => {
  const {client, events} = makeClient();
  try { client.start(channelId); await tick(); const ws = FakeSocket.instances.at(-1); ws.open();
    ws.message({cmd: 10100, retCode: 403, bdy: {}}); assert.equal(ws.readyState, 3); assert.equal(events.statuses.at(-1).state, 'waiting');
  } finally { client.stop(); }
});
