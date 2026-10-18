const $ = id => document.getElementById(id);
let tabId, current, busy = false;
const buttons = ['enable', 'disable', 'auto'];
function render(value) {
  current = value;
  $('error').hidden = true;
  if (!value.supported) {
    $('status').textContent = '치지직 라이브 방송에서 사용해 주세요';
    $('status').dataset.enabled = 'false';
    $('detail').textContent = '방송 탭으로 이동한 뒤 확장 아이콘을 눌러 주세요.';
  } else {
    $('status').textContent = value.enabled ? '익명 채팅 켜짐' : '익명 채팅 꺼짐';
    $('status').dataset.enabled = String(value.enabled);
    $('detail').textContent = (value.control === 'manual' ? '현재 방송에 수동 설정 적용 중' : '활동 제한 자동 감지 중') +
      (value.restricted ? ' · 제한 안내 감지됨' : ' · 제한 안내 없음');
  }
  $('enable').disabled = busy || !value.supported || value.enabled;
  $('disable').disabled = busy || !value.supported || !value.enabled;
  $('auto').disabled = busy || !value.supported || value.control === 'auto';
}
function showError(error) {
  $('error').textContent = error.message || '요청을 처리하지 못했습니다.';
  $('error').hidden = false;
}
async function command(action) {
  if (busy || tabId === undefined) return;
  busy = true; buttons.forEach(id => { $(id).disabled = true; });
  try {
    const reply = await chrome.tabs.sendMessage(tabId, {
      type: 'reader-control', action,
      ...(action !== 'status' ? {channelId: current?.channelId} : {})
    });
    if (!reply?.ok) throw new Error(reply?.error || '확인할 수 없습니다. 방송 탭을 새로고침해 주세요.');
    current = reply; render(reply);
  } catch (error) {
    showError(new Error(/Receiving end|connection|message port/i.test(error.message || '')
      ? '치지직 방송 탭을 새로고침한 뒤 다시 열어 주세요. 기존 버전은 꺼져 있어야 합니다.' : error.message));
    if (!current) {
      $('status').textContent = '현재 방송과 연결할 수 없습니다';
      $('detail').textContent = '치지직 라이브 탭인지 확인해 주세요.';
    }
  } finally {
    busy = false;
    if (current) {
      $('enable').disabled = !current.supported || current.enabled;
      $('disable').disabled = !current.supported || !current.enabled;
      $('auto').disabled = !current.supported || current.control === 'auto';
    }
  }
}
buttons.forEach(action => $(action).addEventListener('click', () => void command(action)));
try {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (tab?.id === undefined) throw new Error('활성 탭을 찾지 못했습니다.');
  tabId = tab.id; await command('status');
} catch (error) {
  $('status').textContent = '현재 탭을 확인할 수 없습니다'; showError(error);
}
