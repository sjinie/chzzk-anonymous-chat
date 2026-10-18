// No cookies API, no account lookup, no message sending endpoint.
let installingRules;
function ensureAnonymousSocket() {
  if (!installingRules) {
    installingRules = chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1, priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{header: 'cookie', operation: 'remove'}],
          responseHeaders: [{header: 'set-cookie', operation: 'remove'}]
        },
        condition: {
          regexFilter: '^wss://kr-ss[1-9]\\.chat\\.naver\\.com/chat$',
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['websocket']
        }
      }]
    }).catch(() => { installingRules = null; throw new Error('익명 연결 보호 규칙을 적용하지 못했습니다. 확장 프로그램의 사이트 권한을 확인해 주세요.'); });
  }
  return installingRules;
}
async function getJSON(url) {
  const response = await fetch(url, {
    method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
    referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`공개 채팅 API 오류 (HTTP ${response.status})`);
  const result = await response.json();
  if (result.code !== 200 || !result.content) {
    throw new Error('익명으로 접근할 수 없는 방송이거나 공개 API가 변경되었습니다.');
  }
  return result.content;
}
async function liveStatus(channelId) {
  const live = await getJSON(`https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`);
  return {
    status: live.status, chatChannelId: live.chatChannelId,
    title: String(live.liveTitle || ''), chatActive: live.chatActive !== false
  };
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our own extension-origin viewer may request a fixed, read-only API operation.
  if (sender.id !== chrome.runtime.id || !sender.url ||
      new URL(sender.url).origin !== new URL(chrome.runtime.getURL('/')).origin ||
      new URL(sender.url).pathname !== '/viewer.html') return false;
  if (!['prepare', 'status'].includes(message?.type) ||
      !/^[a-f0-9]{32}$/.test(message.channelId || '')) return false;
  (async () => {
    const live = await liveStatus(message.channelId);
    if (message.type === 'status' || live.status !== 'OPEN' || !live.chatChannelId || !live.chatActive) {
      return {ok: true, ...live};
    }
    // Fail closed: never open a socket before the cookie-removal rule is installed.
    await ensureAnonymousSocket();
    const token = await getJSON('https://comm-api.game.naver.com/nng_main/v1/chats/access-token?' +
      new URLSearchParams({channelId: live.chatChannelId, chatType: 'STREAMING'}));
    if (typeof token.accessToken !== 'string' || !token.accessToken) throw new Error('익명 채팅 토큰을 받지 못했습니다.');
    return {ok: true, ...live, accessToken: token.accessToken};
  })().then(respond, error => respond({ok: false, error: error?.name === 'TimeoutError' ? '공개 채팅 API 응답 시간이 초과되었습니다.' : (error.message || '연결 오류')}));
  return true;
});
