'use strict';

const $ = (s) => document.querySelector(s);
const appEl = $('#app');
let S = null;
let scale = 1;
const syncers = [];

function fit() {
  scale = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
  appEl.style.transform = 'scale(' + scale + ')';
  appEl.style.left = (window.innerWidth - 1440 * scale) / 2 + 'px';
  appEl.style.top = (window.innerHeight - 900 * scale) / 2 + 'px';
}
window.addEventListener('resize', fit);
fit();

// 칸 머리의 아이콘 (선 굵기·크기 통일)
const ICONS = {
  threshold: '<path d="M3 17l5-6 4 3 4-7 5 5"/><path d="M3 9h18" stroke-dasharray="2 3"/>',
  auto: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/>',
  hotkey: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  key: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  signal: '<path d="M2 12h3l2-6 3 12 3-9 2 5 2-2h5"/>',
  overlay: '<rect x="3" y="4" width="18" height="13" rx="2"/><rect x="12" y="7" width="6" height="4" rx="1"/><path d="M8 21h8"/>',
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function card(color, icon, title) {
  const c = el('section', 'card c-' + color);
  const head = el('div', 'card-head');
  const badge = el('div', 'badge');
  badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[icon] + '</svg>';
  const actions = el('div', 'head-actions');
  head.append(badge, el('h2', null, title), actions);
  c.appendChild(head);
  $('#grid').appendChild(c);
  c.actions = actions;
  return c;
}

function row(parent, label, cls) {
  const r = el('div', 'row' + (cls ? ' ' + cls : ''));
  if (label) r.appendChild(el('label', null, label));
  parent.appendChild(r);
  return r;
}

const get = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
const nest = (path, v) => path.reduceRight((acc, k) => ({ [k]: acc }), v);
const fmt = (v, dec) => Number(v).toFixed(dec);

function setFill(range) {
  const p = ((range.value - range.min) / (range.max - range.min)) * 100;
  range.style.setProperty('--p', p + '%');
}

/** 슬라이더 + 숫자 입력 */
function sliderPair(r, { min, max, step, dec, get: getV, send, enabled }) {
  const range = el('input');
  range.type = 'range';
  range.min = min; range.max = max; range.step = step;
  const num = el('input');
  num.type = 'number';
  num.min = min; num.max = max; num.step = step;
  r.append(range, num);
  let dragging = false;
  range.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  range.addEventListener('input', () => { num.value = fmt(range.value, dec); setFill(range); send(Number(range.value)); });
  num.addEventListener('change', () => { if (num.value !== '') send(Number(num.value)); });
  num.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') num.blur(); });
  syncers.push(() => {
    const v = getV();
    if (!dragging && document.activeElement !== range) range.value = v;
    if (document.activeElement !== num) num.value = fmt(v, dec);
    setFill(range);
    const on = enabled ? enabled() : true;
    range.disabled = !on; num.disabled = !on;
  });
}

function slider(parent, label, path, min, max, step, dec, enabled) {
  sliderPair(row(parent, label), { min, max, step, dec, enabled, get: () => get(S.settings, path), send: (v) => window.api.patch(nest(path, v)) });
}

/** 분할 버튼 */
function segBox(options, getVal, onPick, cls) {
  const box = el('div', 'seg' + (cls ? ' ' + cls : ''));
  const btns = options.map((o) => {
    const b = el('button', null, o.label);
    b.addEventListener('click', () => onPick(o.value));
    box.appendChild(b);
    return b;
  });
  syncers.push(() => {
    const cur = getVal();
    btns.forEach((b, i) => b.classList.toggle('on', options[i].value === cur));
  });
  return box;
}

function seg(parent, label, options, getVal, onPick) {
  row(parent, label).appendChild(segBox(options, getVal, onPick));
}

/** 키 지정 칩: 누르고 키를 치면 저장 */
function capture(parent, label, getLabel, onKey) {
  const r = row(parent, label);
  const b = el('button', 'keychip');
  r.appendChild(b);
  let listening = false;
  const stop = () => { listening = false; b.classList.remove('listen'); };
  b.addEventListener('click', () => { listening = true; b.classList.add('listen'); b.classList.remove('bad'); b.textContent = '키를 누르세요'; b.focus(); });
  b.addEventListener('blur', () => { if (listening) { stop(); b.textContent = getLabel(); } });
  b.addEventListener('keydown', async (e) => {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stop(); b.textContent = getLabel(); return; }
    const ok = await onKey({ code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
    stop();
    if (!ok) { b.classList.add('bad'); b.textContent = '지원하지 않는 키'; setTimeout(() => { b.classList.remove('bad'); b.textContent = getLabel(); }, 1200); }
  });
  syncers.push(() => { if (!listening && !b.classList.contains('bad')) b.textContent = getLabel(); });
}

const accelText = (a) => a.split('+').join(' + ');

function build() {
  // ── 1단 ──
  let k = card('amber', 'threshold', '역치');
  slider(k, '역치', ['trigger', 'threshold'], 0.5, 100, 0.1, 1);
  slider(k, '해제 비율', ['trigger', 'releaseRatio'], 0.4, 0.95, 0.01, 2);
  slider(k, '반응 속도', ['trigger', 'windowMs'], 25, 200, 5, 0);

  k = card('coral', 'hotkey', '단축키');
  capture(k, '가동', () => accelText(S.settings.hotkeys.toggle),
    async (ev) => { const a = await window.api.accel(ev); if (!a) return false; window.api.patch({ hotkeys: { toggle: a } }); return true; });
  capture(k, '오버레이', () => accelText(S.settings.hotkeys.overlay),
    async (ev) => { const a = await window.api.accel(ev); if (!a) return false; window.api.patch({ hotkeys: { overlay: a } }); return true; });
  let r = row(k, '장치');
  const dev = el('div', 'val');
  const re = el('button', 'btn', '다시 연결');
  re.addEventListener('click', () => window.api.reconnect());
  r.append(dev, re);
  syncers.push(() => {
    const l = S.live;
    dev.textContent = l.connected ? (l.name || 'SpikerBox') : l.openError || '없음';
    dev.className = 'val' + (l.connected ? '' : l.openError ? ' err' : ' off');
  });

  k = card('sky', 'signal', '신호');
  seg(k, '채널', [{ label: '1', value: 1 }, { label: '2', value: 2 }], () => S.settings.signal.channel, (v) => window.api.patch({ signal: { channel: v } }));
  seg(k, '전원', [{ label: '60 Hz', value: 60 }, { label: '50 Hz', value: 50 }], () => S.settings.signal.mainsHz, (v) => window.api.patch({ signal: { mainsHz: v } }));
  slider(k, '세로 범위', ['signal', 'scale'], 20, 600, 1, 0);

  // ── 2단 ──
  k = card('amber', 'auto', '역치 자동 설정');
  const cs = el('button', 'btn', '시작');
  cs.addEventListener('click', () => (S.cal.phase !== 'off' && S.cal.phase !== 'done' ? window.api.calCancel() : window.api.calStart()));
  k.actions.appendChild(cs);
  r = row(k, null);
  const steps = el('div', 'steps');
  const stepEls = ['쉬기', '준비', '힘주기'].map((n) => {
    const d = el('div', 'step');
    d.append(el('i'), el('span', null, n));
    steps.appendChild(d);
    return d;
  });
  const count = el('div', 'count', '');
  r.append(steps, count);
  r = row(k, null, 'tall');
  const tiles = el('div', 'tiles');
  const tile = (label, main) => {
    const t = el('div', 'tile' + (main ? ' main' : ''));
    const v = el('div', 't-val', '--');
    t.append(el('div', 't-label', label), v);
    tiles.appendChild(t);
    return v;
  };
  const tRest = tile('쉴 때');
  const tSq = tile('힘줄 때');
  const tTh = tile('제안 역치', true);
  r.appendChild(tiles);
  const sensRow = row(k, '민감도');
  sliderPair(sensRow, { min: 5, max: 90, step: 1, dec: 0, get: () => Math.round(S.calSens * 100), send: (v) => window.api.calSens(v / 100) });
  r = row(k, null);
  const warn = el('div', 'warn');
  const ap = el('button', 'btn solid wide', '적용');
  ap.addEventListener('click', () => window.api.calApply());
  r.append(warn, ap);
  syncers.push(() => {
    const c = S.cal;
    const run = c.phase !== 'off' && c.phase !== 'done';
    cs.textContent = run ? '취소' : '시작';
    cs.classList.toggle('stop', run);
    cs.disabled = !run && !S.live.connected;
    const STEP_MS = [4000, 2000, 4000];
    stepEls.forEach((d, i) => {
      const cur = run && c.step === i;
      const done = (run && c.step > i) || (!run && c.result && c.result.ok);
      d.classList.toggle('on', cur);
      d.classList.toggle('done', !!done);
      d.firstChild.style.width = cur ? (100 * (1 - c.left / STEP_MS[i])).toFixed(1) + '%' : '';
    });
    count.textContent = run ? (c.left / 1000).toFixed(1) : '';
    const res = c.result;
    const st = res && res.ok ? res.stats : null;
    tRest.textContent = st ? fmt(st.restHigh, 1) : '--';
    tSq.textContent = st && st.sqTop != null ? fmt(st.sqTop, 1) : '--';
    tTh.textContent = S.suggestion ? fmt(S.suggestion.threshold, 1) : '--';
    const msg = res ? (res.error || (res.warnings && res.warnings[0]) || (res.ok && !S.suggestion ? '힘줄 때 신호가 약합니다' : '')) : '';
    warn.textContent = msg;
    warn.title = msg;
    warn.hidden = !msg;
    ap.disabled = !(res && res.ok && S.suggestion);
  });

  k = card('coral', 'key', '근육 → 키');
  capture(k, '누를 키', () => S.keys.label,
    async (ev) => { window.api.patch({ key: { code: ev.code } }); await new Promise((res) => setTimeout(res, 120)); const s = await window.api.getState(); S = s; return s.settings.key.code === ev.code; });
  seg(k, '방식', [{ label: '누르는 동안', value: 'hold' }, { label: '한 번만', value: 'tap' }], () => S.settings.key.mode, (v) => window.api.patch({ key: { mode: v } }));
  slider(k, '누름 시간', ['key', 'tapMs'], 10, 300, 1, 0, () => S.settings.key.mode === 'tap');
  slider(k, '쿨다운', ['key', 'cooldownMs'], 0, 1000, 5, 0, () => S.settings.key.mode === 'tap');
  r = row(k, null);
  const kt = el('button', 'btn wide', '3초 뒤 키 테스트');
  kt.addEventListener('click', () => window.api.keyTest());
  r.appendChild(kt);
  syncers.push(() => { kt.disabled = !S.keys.available; });

  k = card('sky', 'overlay', '오버레이');
  const mon = el('div', 'seg small');
  const dr = el('button', 'btn', '끌어서 정하기');
  dr.addEventListener('click', () => window.api.setDrag(!S.dragMode));
  k.actions.append(mon, dr);
  let monKey = '';
  syncers.push(() => {
    const key = S.displays.map((d) => d.index).join(',');
    if (key !== monKey) {
      monKey = key;
      mon.textContent = '';
      S.displays.forEach((d, i) => {
        const b = el('button', null, String(i + 1));
        b.addEventListener('click', () => window.api.patch({ overlay: { display: i } }));
        mon.appendChild(b);
      });
    }
    mon.hidden = S.displays.length < 2;
    const cur = Number.isInteger(S.settings.overlay.display) ? S.settings.overlay.display : S.displays.findIndex((d) => d.primary);
    [...mon.children].forEach((b, i) => b.classList.toggle('on', i === cur));
    dr.textContent = S.dragMode ? '끌기 끝내기' : '끌어서 정하기';
    dr.classList.toggle('stop', S.dragMode);
  });
  slider(k, '크기', ['overlay', 'scale'], 50, 200, 1, 0);
  slider(k, '가로 위치', ['overlay', 'x'], 0, 100, 1, 0);
  slider(k, '세로 위치', ['overlay', 'y'], 0, 100, 1, 0);
  slider(k, '투명도', ['overlay', 'opacity'], 30, 100, 1, 0);
  slider(k, '표시 시간', ['signal', 'seconds'], 0.5, 5, 0.1, 1);
}

// ── 위쪽 실시간 화면 ──
$('#run').addEventListener('click', () => window.api.setRunning(!S.running));
$('#sw-test').addEventListener('click', () => window.api.setTest(!S.test));
$('#sw-ov').addEventListener('click', () => window.api.toggleOverlay());

const HIST_MS = 6000;
const hist = [];
let shownForce = 0;
let lastWave = null;

function render(state) {
  S = state;
  const l = S.live;
  const t = performance.now();
  hist.push({ t, v: l.connected ? l.rms : 0 });
  while (hist.length && t - hist[0].t > HIST_MS + 500) hist.shift();
  lastWave = S.wave;

  const st = $('#status');
  st.classList.toggle('ok', l.connected);
  st.classList.toggle('err', !l.connected && !!l.openError);
  $('#status-text').textContent = l.connected ? 'SpikerBox · ' + l.fps.toLocaleString('en-US') + ' fps' : l.openError ? '장치 열기 실패' : '장치 없음';

  const kc = $('#keycap');
  $('#keycap-label').textContent = S.keys.label;
  kc.classList.toggle('down', l.pressed);
  kc.classList.toggle('test', S.test);

  $('#run').classList.toggle('on', S.running);
  $('#run-text').textContent = S.running ? '가동 정지' : '가동 시작';
  $('#sw-test').classList.toggle('on', S.test);
  $('#sw-ov').classList.toggle('on', S.overlayVisible);
  $('#version').textContent = 'v' + S.version;
  syncers.forEach((f) => f());
}

function frame() {
  if (S) {
    const l = S.live;
    // 큰 숫자는 부드럽게 따라간다
    shownForce += ((l.connected ? l.rms : 0) - shownForce) * 0.25;
    const f = $('#force');
    f.textContent = l.connected ? shownForce.toFixed(1) : '--';
    f.className = 'force-num' + (!l.connected ? ' off' : l.active ? ' hot' : '');

    const w = Wave.prep($('#wave'), scale);
    Wave.grid(w.ctx, w.w, w.h, '#182038', 4);
    if (lastWave) Wave.envelope(w.ctx, w.w, w.h, lastWave.env, lastWave.range, l.active ? '#FF8F8F' : '#82B9FF', l.active);

    const h = Wave.prep($('#hist'), scale);
    Wave.grid(h.ctx, h.w, h.h, '#182038', 4);
    const th = S.settings.trigger.threshold;
    Wave.rmsHistory(h.ctx, h.w, h.h, hist, {
      now: performance.now() - 40, span: HIST_MS, threshold: th, release: th * S.settings.trigger.releaseRatio,
      color: '#82B9FF', hot: '#FF8F8F', line: '#F4B860', label: '역치 ' + th.toFixed(1),
    });
  }
  requestAnimationFrame(frame);
}

(async () => {
  S = await window.api.getState();
  build();
  render(S);
  window.api.onState(render);
  requestAnimationFrame(frame);
})();
