'use strict';

// 사용자 화면: 게임 고르기, 게임마다 누를 키 지정, 지금 힘 막대. 관리자 화면은 Ctrl+D.

const $ = (s, r = document) => r.querySelector(s);
const appEl = $('#app');
let S = null;
const syncers = [];

function fit() {
  const k = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
  appEl.style.transform = 'scale(' + k + ')';
  appEl.style.left = (window.innerWidth - 1440 * k) / 2 + 'px';
  appEl.style.top = (window.innerHeight - 900 * k) / 2 + 'px';
}
window.addEventListener('resize', fit);
fit();

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.code === 'KeyD') { e.preventDefault(); window.api.setMode('admin'); }
});

const MOUSE_CODES = ['MouseLeft', 'MouseMiddle', 'MouseRight', 'MouseBack', 'MouseForward'];

/** 칩을 누르고 키를 치거나 마우스 버튼을 누르면 그 게임의 키로 저장 (Esc 는 취소) */
function keyCapture(b, gameId) {
  const label = () => (S.games.find((g) => g.id === gameId) || {}).label || '';
  let listening = false;
  let ignoreClickUntil = 0;
  const save = async (code) => {
    await window.api.patch({ user: { keys: { [gameId]: code } } });
    S = await window.api.getState();
    return (S.games.find((g) => g.id === gameId) || {}).key === code;
  };
  const stop = () => { listening = false; b.classList.remove('listen'); window.removeEventListener('mousedown', onMouse, true); };
  const fail = () => { b.classList.add('bad'); b.textContent = '안 되는 키'; setTimeout(() => { b.classList.remove('bad'); b.textContent = label(); }, 1200); };
  async function onMouse(e) {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    ignoreClickUntil = Date.now() + 400;
    const code = MOUSE_CODES[e.button];
    const ok = code ? await save(code) : false;
    stop();
    if (!ok) fail();
  }
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (Date.now() < ignoreClickUntil) return;
    listening = true;
    b.classList.add('listen');
    b.classList.remove('bad');
    b.textContent = '키를 누르거나 클릭';
    b.focus();
    window.addEventListener('mousedown', onMouse, true);
  });
  b.addEventListener('blur', () => { if (listening) { stop(); b.textContent = label(); } });
  b.addEventListener('keydown', async (e) => {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stop(); b.textContent = label(); return; }
    const ok = await save(e.code);
    stop();
    if (!ok) fail();
  });
  syncers.push(() => { if (!listening && !b.classList.contains('bad')) b.textContent = label(); });
}

document.querySelectorAll('.game').forEach((card) => {
  const id = card.dataset.id;
  keyCapture($('.keychip', card), id);
  $('.start', card).addEventListener('click', () => window.api.playGame(id));
  // Windows 게임(얼불춤): 켜져 있는지 표시, 꺼져 있으면 미리 켜기
  const pre = $('.prelaunch', card);
  const st = $('.tag.state', card);
  if (pre) pre.addEventListener('click', (e) => { e.stopPropagation(); window.api.prelaunchGame(id); });
  if (st) {
    syncers.push(() => {
      const g = S.games.find((x) => x.id === id);
      const state = g ? g.state : 'off';
      pre.hidden = state !== 'off';
      st.hidden = state === 'off';
      st.textContent = state === 'on' ? '켜져 있음' : '켜는 중…';
      st.className = 'tag state ' + (state === 'on' ? 'on' : 'wait');
    });
  }
});

let shown = 0;
function render(state) {
  S = state;
  const l = S.live;
  $('#status').classList.toggle('ok', l.connected);
  $('#status-text').textContent = l.connected ? '근전도 연결됨' : '근전도 장치 없음';
  $('#version').textContent = 'v' + S.version;
  syncers.forEach((f) => f());
}

function frame() {
  if (S) {
    const l = S.live;
    shown += ((l.connected ? l.rms : 0) - shown) * 0.25;
    const full = Math.max(0.1, S.settings.trigger.threshold * 2);
    $('#fill').style.width = Math.min(100, (shown / full) * 100) + '%';
    $('.meter').classList.toggle('on', l.active);
    const f = $('#force');
    f.textContent = l.connected ? shown.toFixed(1) : '--';
    f.className = 'f-num' + (!l.connected ? ' off' : l.active ? ' on' : '');
  }
  requestAnimationFrame(frame);
}

(async () => {
  render(await window.api.getState());
  window.api.onState(render);
  requestAnimationFrame(frame);
})();
