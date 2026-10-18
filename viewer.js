import {ChatClient} from './chat-client.mjs';
const $ = id => document.getElementById(id);
const list = $('messages');
const channelId = new URLSearchParams(location.search).get('channel');
let paused = false, fontSize = 14, dropped = 0;
let pending = [], rows = new Map();
let seen = new Set(), seenOrder = [];
const MAX_ROWS = 400, MAX_PENDING = 400, MAX_SEEN = 2500;
function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 70; }
function safeImage(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['ssl.pstatic.net', 'nng-phinf.pstatic.net'].includes(u.hostname) ? u.href : null; } catch { return null; }
}
function appendText(parent, text, emojis) {
  // Never use innerHTML for nicknames, chat content, notices, or API errors.
  const pattern = /\{:([^{}:\s]{1,100}):\}/g;
  let end = 0, match;
  while ((match = pattern.exec(text))) {
    parent.append(document.createTextNode(text.slice(end, match.index)));
    const src = safeImage(emojis[match[1]]);
    if (src) {
      const img = document.createElement('img'); img.className = 'emoji';
      img.referrerPolicy = 'no-referrer'; img.alt = match[0]; img.src = src;
      parent.append(img);
    } else parent.append(document.createTextNode(match[0]));
    end = pattern.lastIndex;
  }
  parent.append(document.createTextNode(text.slice(end)));
}
function hideRow(row) {
  row.classList.add('hidden'); row.querySelector('.body').textContent = '[운영 정책에 따라 가려진 메시지]';
}
function render(batch) {
  const stick = nearBottom();
  const fragment = document.createDocumentFragment();
  for (const chat of batch) {
    if (![1, 10, 11].includes(chat.type)) continue;
    const row = document.createElement('div'); row.className = 'message'; row.dataset.role = chat.role;
    row.dataset.uid = chat.uid; row.dataset.time = String(chat.time);
    const name = document.createElement('span'); name.className = 'nickname'; name.textContent = chat.nickname;
    const body = document.createElement('span'); body.className = 'body';
    row.append(name);
    if (chat.type === 10) {
      row.dataset.donation = 'true';
      const amount = document.createElement('span'); amount.className = 'amount';
      amount.textContent = chat.amount > 0 ? `${chat.amount.toLocaleString('ko-KR')} 치즈 ` : '후원 ';
      row.append(amount);
    }
    appendText(body, chat.text, chat.emojis); row.append(body);
    if (chat.hidden) hideRow(row);
    fragment.append(row); rows.set(chat.key, row);
  }
  if (!fragment.childNodes.length) return;
  $('empty')?.remove(); list.append(fragment);
  while (rows.size > MAX_ROWS) { const key = rows.keys().next().value; rows.get(key).remove(); rows.delete(key); }
  if (stick) list.scrollTop = list.scrollHeight;
  $('latest').hidden = nearBottom() || paused;
}
function receive(batch) {
  const fresh = [];
  for (const chat of batch) {
    if (seen.has(chat.key)) continue;
    seen.add(chat.key); seenOrder.push(chat.key); fresh.push(chat);
  }
  while (seenOrder.length > MAX_SEEN) seen.delete(seenOrder.shift());
  if (paused) {
    pending.push(...fresh);
    if (pending.length > MAX_PENDING) { dropped += pending.length - MAX_PENDING; pending = pending.slice(-MAX_PENDING); }
    bufferStatus();
  } else render(fresh);
}
function bufferStatus() {
  $('buffer').hidden = !paused && dropped === 0;
  $('buffer').textContent = paused
    ? `일시정지 중 · 대기 ${pending.length}개` + (dropped ? ` · 오래된 ${dropped}개 생략` : '')
    : `일시정지 중 쌓인 채팅 중 오래된 ${dropped}개는 생략했습니다.`;
}
const client = new ChatClient({
  request: (type, channelId) => chrome.runtime.sendMessage({type, channelId}),
  status: value => {
    $('status').textContent = value.text; $('status').dataset.state = value.state;
    if (value.title) document.title = value.title + ' · 익명 채팅';
    if ($('empty') && value.state === 'waiting') $('empty').textContent = '아직 받은 채팅이 없습니다. 연결 상태를 확인해 주세요.';
  },
  messages: receive,
  notice: chat => {
    $('notice').hidden = !chat;
    $('notice').textContent = chat ? '공지 · ' + (chat.hidden ? '[가려진 메시지]' : chat.text) : '';
  },
  moderation: body => {
    // A server moderation event can target a user, a message, or a time range.
    const uid = body.blindUserId ?? body.targetUserId ?? body.userId ?? body.uid;
    const time = Number(body.messageTime ?? body.msgTime ?? 0);
    const blindTime = Number(body.blindTime ?? 0);
    const matches = chat => (!uid || chat.uid === String(uid)) && (!time || chat.time === time) && (!blindTime || chat.time <= blindTime);
    if (!uid && !time && !blindTime) return;
    for (const row of rows.values()) {
      if (matches({uid: row.dataset.uid, time: Number(row.dataset.time)})) hideRow(row);
    }
    for (const chat of pending) if (matches(chat)) chat.hidden = true;
  }
});
$('reconnect').addEventListener('click', () => {
  if (/^[a-f0-9]{32}$/.test(channelId || '')) client.start(channelId);
});
$('pause').addEventListener('click', () => {
  paused = !paused;
  if (paused) dropped = 0;
  $('pause').textContent = paused ? '다시 보기' : '일시정지'; $('pause').setAttribute('aria-pressed', String(paused));
  if (!paused) { render(pending); pending = []; }
  bufferStatus();
});
function size(delta) { fontSize = Math.max(11, Math.min(24, fontSize + delta)); document.documentElement.style.setProperty('--font-size', fontSize + 'px'); }
$('smaller').addEventListener('click', () => size(-1)); $('larger').addEventListener('click', () => size(1));
list.addEventListener('scroll', () => { $('latest').hidden = nearBottom() || paused; }, {passive: true});
$('latest').addEventListener('click', () => { list.scrollTop = list.scrollHeight; $('latest').hidden = true; });
window.addEventListener('pagehide', () => client.stop());
window.addEventListener('pageshow', event => { if (event.persisted && /^[a-f0-9]{32}$/.test(channelId || '')) client.start(channelId); });
if (/^[a-f0-9]{32}$/.test(channelId || '')) client.start(channelId);
else $('status').textContent = '올바른 치지직 방송 주소에서 열어 주세요.';
