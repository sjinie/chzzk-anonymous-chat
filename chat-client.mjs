export function socketURL(cid) {
  const server = [...cid].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 9 + 1;
  return `wss://kr-ss${server}.chat.naver.com/chat`;
}
export function object(value) {
  if (typeof value === 'string') { try { return JSON.parse(value) || {}; } catch { return {}; } }
  return value && typeof value === 'object' ? value : {};
}
export function parseChat(raw) {
  const profile = object(raw.profile), extras = object(raw.extras);
  const time = Number(raw.msgTime ?? raw.messageTime ?? 0);
  const uid = String(raw.uid ?? raw.userId ?? profile.userIdHash ?? '');
  const content = String(raw.msg ?? raw.content ?? raw.message ?? '').slice(0, 5000);
  return {
    key: String(raw.msgTid || `${uid}:${time}:${content}`), uid, time,
    nickname: String(profile.nickname || extras.nickname || '익명').slice(0, 100),
    role: String(profile.userRoleCode || ''),
    text: content,
    type: Number(raw.msgTypeCode ?? raw.messageTypeCode ?? 1),
    hidden: (raw.msgStatusType ?? raw.messageStatusType) === 'HIDDEN',
    emojis: object(extras.emojis), amount: Number(extras.payAmount || 0)
  };
}
// An allowlist makes it impossible for the viewer to send a chat message.
const READ_ONLY_COMMANDS = new Set([0, 100, 5101, 10000]);
export class ChatClient {
  constructor({request, status, messages, notice, moderation, WebSocketImpl = globalThis.WebSocket}) {
    Object.assign(this, {request, status, messages, notice, moderation, WebSocketImpl});
    this.active = false; this.epoch = 0; this.failures = 0;
  }
  start(channelId) {
    this.stop(); this.channelId = channelId; this.active = true; this.failures = 0;
    void this.connect();
  }
  cleanup() {
    clearTimeout(this.retryTimer); clearTimeout(this.handshakeTimer);
    clearInterval(this.heartbeat); clearInterval(this.poller);
    if (this.ws) {
      this.ws.onclose = this.ws.onmessage = this.ws.onopen = this.ws.onerror = null;
      this.ws.close(); this.ws = null;
    }
  }
  stop() { this.active = false; this.epoch++; this.cleanup(); }
  send(frame) {
    if (!READ_ONLY_COMMANDS.has(frame.cmd)) throw new Error('읽기 전용: 허용되지 않은 명령');
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(frame));
  }
  envelope(cmd, bdy, tid) {
    return {ver: '2', svcid: 'game', cid: this.cid, ...(this.sid ? {sid: this.sid} : {}), cmd, tid, bdy};
  }
  retry(text, delay) {
    if (!this.active) return;
    this.epoch++; this.cleanup(); this.sid = null;
    const wait = delay ?? Math.min(60000, 2000 * (2 ** Math.min(this.failures++, 5))) + Math.floor(Math.random() * 1000);
    this.status({state: 'waiting', text: `${text} · ${Math.ceil(wait / 1000)}초 후 재시도`});
    this.retryTimer = setTimeout(() => void this.connect(), wait);
  }
  async connect() {
    if (!this.active) return;
    this.cleanup(); this.sid = null;
    const epoch = ++this.epoch;
    const current = () => this.active && epoch === this.epoch;
    this.status({state: 'connecting', text: '익명 채팅 연결 중…'});
    try {
      const info = await this.request('prepare', this.channelId);
      if (!current()) return;
      if (!info.ok) throw new Error(info.error || '공개 채팅 조회 실패');
      if (info.status !== 'OPEN' || !info.chatChannelId || !info.chatActive) {
        this.retry(info.status !== 'OPEN' ? '방송이 종료되었거나 오프라인입니다' : '공개 채팅이 비활성화되어 있습니다', 60000); return;
      }
      if (!info.accessToken) throw new Error('익명 채팅 토큰이 없습니다');
      this.cid = info.chatChannelId;
      const ws = this.ws = new this.WebSocketImpl(socketURL(this.cid));
      this.lastReceived = Date.now();
      this.handshakeTimer = setTimeout(() => { if (current()) this.retry('채팅 서버 응답 시간 초과'); }, 12000);
      ws.onopen = () => {
        if (!current()) return;
        this.send(this.envelope(100, {uid: null, devType: 2001, accTkn: info.accessToken, auth: 'READ'}, 1));
      };
      ws.onmessage = event => {
        if (!current() || typeof event.data !== 'string' || event.data.length > 2_000_000) return;
        let frame; try { frame = JSON.parse(event.data); } catch { return; }
        this.lastReceived = Date.now();
        if (frame.cmd === 0) { this.send({ver: '2', cmd: 10000}); return; }
        if (frame.cmd === 10100) {
          if ((frame.retCode !== undefined && frame.retCode !== 0) || !frame.bdy?.sid) {
            this.retry('서버가 익명 채팅 연결을 허용하지 않았습니다', 60000); return;
          }
          clearTimeout(this.handshakeTimer); this.sid = frame.bdy.sid; this.failures = 0;
          this.status({state: 'connected', text: '익명 연결됨 · 읽기 전용', title: info.title});
          this.send(this.envelope(5101, {recentMessageCount: 50}, 2));
          clearInterval(this.heartbeat); clearInterval(this.poller);
          this.heartbeat = setInterval(() => {
            if (!current()) return;
            if (Date.now() - this.lastReceived > 70000) { this.retry('채팅 수신이 중단되었습니다'); return; }
            this.send({ver: '2', cmd: 0});
          }, 20000);
          this.poller = setInterval(() => void this.poll(epoch), 45000);
        } else if ([93101, 93102, 15101].includes(frame.cmd)) {
          const batch = Array.isArray(frame.bdy) ? frame.bdy : frame.bdy?.messageList;
          if (Array.isArray(batch)) this.messages(batch.slice(-500).filter(x => x && typeof x === 'object').map(parseChat));
          if (frame.bdy?.notice) this.notice(parseChat(frame.bdy.notice));
        } else if (frame.cmd === 94010) {
          this.notice(frame.bdy && Object.keys(frame.bdy).length ? parseChat(frame.bdy) : null);
        } else if ([94006, 94008].includes(frame.cmd)) {
          this.moderation(object(frame.bdy));
        }
      };
      ws.onerror = () => { if (current()) this.retry('채팅 서버 연결 오류'); };
      ws.onclose = () => { if (current()) this.retry('채팅 연결이 끊겼습니다'); };
    } catch (error) { if (current()) this.retry(error.message || '연결 오류'); }
  }
  async poll(epoch) {
    if (this.polling || !this.active || epoch !== this.epoch) return;
    this.polling = true;
    try {
      const info = await this.request('status', this.channelId);
      if (!this.active || epoch !== this.epoch || !info.ok) return;
      if (info.status !== 'OPEN' || !info.chatActive) this.retry('방송이 종료되었거나 채팅이 비활성화되었습니다', 60000);
      else if (info.chatChannelId && info.chatChannelId !== this.cid) this.retry('새 방송의 채팅으로 전환합니다', 1000);
    } catch { /* Socket can remain healthy during a polling API failure. */ }
    finally { this.polling = false; }
  }
}
