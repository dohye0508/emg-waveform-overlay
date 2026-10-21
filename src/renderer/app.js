'use strict';

const $ = (s) => document.querySelector(s);
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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function card(parent, title) {
  const c = el('section', 'card');
  c.appendChild(el('h2', null, title));
  parent.appendChild(c);
  return c;
}

function row(parent, label) {
  const r = el('div', 'row');
  if (label) r.appendChild(el('label', null, label));
  parent.appendChild(r);
  return r;
}

const get = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
const nest = (path, v) => path.reduceRight((acc, k) => ({ [k]: acc }), v);

function fmt(v, dec) {
  return Number(v).toFixed(dec);
}

/** 슬라이더 + 숫자 입력. path 는 settings 안의 위치 */
function slider(parent, label, path, min, max, step, dec, enabled) {
  const r = row(parent, label);
  const range = el('input');
  range.type = 'range';
  range.min = min; range.max = max; range.step = step;
  const num = el('input');
  num.type = 'number';
  num.min = min; num.max = max; num.step = step;
  r.append(range, num);
  let dragging = false;
  const send = (v) => window.api.patch(nest(path, v));
  range.addEventListener('pointerdown', () => { dragging = true; });
  window.addEventListener('pointerup', () => { dragging = false; });
  range.addEventListener('input', () => { num.value = fmt(range.value, dec); send(Number(range.value)); });
  num.addEventListener('change', () => { if (num.value !== '') send(Number(num.value)); });
  num.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') num.blur(); });
  syncers.push(() => {
    const v = get(S.settings, path);
    if (!dragging && document.activeElement !== range) range.value = v;
    if (document.activeElement !== num) num.value = fmt(v, dec);
    const on = enabled ? enabled() : true;
    range.disabled = !on; num.disabled = !on;
  });
}

/** 분할 버튼. options: [{label, value, num}] */
function seg(parent, label, options, getVal, onPick, enabled) {
  const r = row(parent, label);
  const box = el('div', 'seg');
  const btns = options.map((o) => {
    const b = el('button', o.num ? 'num' : '', o.label);
    b.addEventListener('click', () => onPick(o.value));
    box.appendChild(b);
    return b;
  });
  r.appendChild(box);
  syncers.push(() => {
    const cur = getVal();
    btns.forEach((b, i) => {
      b.classList.toggle('on', options[i].value === cur);
      b.disabled = enabled ? !enabled() : false;
    });
  });
}

/** 키 지정 칩: 누르고 키를 치면 저장 */
function capture(parent, label, getLabel, onKey, escapeCancels = true) {
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
    if (e.key === 'Escape' && escapeCancels) { stop(); b.textContent = getLabel(); return; }
    const ok = await onKey({ code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
    stop();
    if (!ok) { b.classList.add('bad'); b.textContent = '지원하지 않는 키'; setTimeout(() => { b.classList.remove('bad'); b.textContent = getLabel(); }, 1200); }
  });
  syncers.push(() => { if (!listening && !b.classList.contains('bad')) b.textContent = getLabel(); });
}

function build() {
  const cols = $('#cols');
  const c1 = el('div', 'col'), c2 = el('div', 'col'), c3 = el('div', 'col');
  cols.append(c1, c2, c3);

  // ── 가동 ──
  let k = card(c1, '가동');
  seg(k, '시험 모드', [{ label: '끔', value: false }, { label: '켬', value: true }], () => S.test, (v) => window.api.setTest(v));
  seg(k, '오버레이', [{ label: '숨김', value: false }, { label: '표시', value: true }], () => S.overlayVisible, () => window.api.toggleOverlay());
  let r = row(k, '장치');
  const dev = el('div', 'val', '');
  const re = el('button', 'btn ghost', '다시 연결');
  re.addEventListener('click', () => window.api.reconnect());
  r.append(dev, re);
  syncers.push(() => {
    const l = S.live;
    dev.textContent = l.connected ? (l.name || 'SpikerBox') : l.openError ? l.openError : '없음';
    dev.style.color = l.openError && !l.connected ? 'var(--magenta)' : '';
    dev.style.textAlign = 'left';
  });

  // ── 단축키 ──
  k = card(c1, '단축키');
  capture(k, '가동 시작/정지', () => S.settings.hotkeys.toggle.split('+').join(' + '),
    async (ev) => { const a = await window.api.accel(ev); if (!a) return false; window.api.patch({ hotkeys: { toggle: a } }); return true; });
  capture(k, '오버레이 표시', () => S.settings.hotkeys.overlay.split('+').join(' + '),
    async (ev) => { const a = await window.api.accel(ev); if (!a) return false; window.api.patch({ hotkeys: { overlay: a } }); return true; });

  // ── 근육 → 키 ──
  k = card(c1, '근육 → 키');
  capture(k, '누를 키', () => S.keys.label,
    async (ev) => { window.api.patch({ key: { code: ev.code } }); await new Promise((res) => setTimeout(res, 120)); const s = await window.api.getState(); S = s; return s.settings.key.code === ev.code; });
  seg(k, '방식', [{ label: '유지', value: 'hold' }, { label: '한 번만', value: 'tap' }], () => S.settings.key.mode, (v) => window.api.patch({ key: { mode: v } }));
  slider(k, '누름 시간', ['key', 'tapMs'], 10, 300, 1, 0, () => S.settings.key.mode === 'tap');
  slider(k, '쿨다운', ['key', 'cooldownMs'], 0, 1000, 5, 0, () => S.settings.key.mode === 'tap');
  r = row(k, '');
  const kt = el('button', 'btn ghost wide', '3초 뒤 키 테스트');
  kt.addEventListener('click', () => window.api.keyTest());
  r.appendChild(kt);
  syncers.push(() => { kt.disabled = !S.keys.available; });

  // ── 역치 ──
  k = card(c2, '역치');
  r = row(k, '지금 힘');
  const meter = el('div', 'meter');
  const fill = el('div', 'fill'), tick = el('div', 'tick'), rel = el('div', 'tick rel');
  meter.append(fill, rel, tick);
  const big = el('div', 'big', '0.0');
  r.append(meter, big);
  syncers.push(() => {
    const th = S.settings.trigger.threshold;
    const full = Math.max(0.1, th * 2);
    fill.style.width = Math.min(100, (S.live.rms / full) * 100) + '%';
    tick.style.left = '50%';
    rel.style.left = Math.min(100, ((th * S.settings.trigger.releaseRatio) / full) * 100) + '%';
    meter.classList.toggle('active', S.live.active);
    big.classList.toggle('active', S.live.active);
    big.textContent = S.live.connected ? S.live.rms.toFixed(1) : '--';
  });
  slider(k, '역치', ['trigger', 'threshold'], 0.5, 100, 0.1, 1);
  slider(k, '해제 비율', ['trigger', 'releaseRatio'], 0.4, 0.95, 0.01, 2);
  slider(k, '반응 속도', ['trigger', 'windowMs'], 25, 200, 5, 0);

  // ── 자동 설정 ──
  k = card(c2, '역치 자동 설정');
  r = row(k, '');
  const cs = el('button', 'btn wide', '시작');
  cs.addEventListener('click', () => (S.cal.phase !== 'off' && S.cal.phase !== 'done' ? window.api.calCancel() : window.api.calStart()));
  r.appendChild(cs);
  r = row(k, '');
  const steps = el('div', 'steps');
  const names = ['쉬기', '준비', '힘주기'];
  const stepEls = names.map((n) => { const d = el('div', null, n); steps.appendChild(d); return d; });
  const count = el('div', 'count', '');
  r.append(steps, count);
  const lines = {};
  [['restHigh', '쉴 때 상한'], ['sqTop', '힘줄 때'], ['th', '제안 역치']].forEach(([key, label]) => {
    const rr = row(k, label);
    lines[key] = el('div', 'val', '--');
    rr.appendChild(lines[key]);
  });
  const warnRow = row(k, '');
  const warn = el('div', 'val warn', '');
  warnRow.appendChild(warn);
  const sensRow = row(k, '민감도');
  const sr = el('input'); sr.type = 'range'; sr.min = 5; sr.max = 90; sr.step = 1;
  const sn = el('input'); sn.type = 'number'; sn.min = 5; sn.max = 90; sn.step = 1;
  sensRow.append(sr, sn);
  sr.addEventListener('input', () => { sn.value = sr.value; window.api.calSens(Number(sr.value) / 100); });
  sn.addEventListener('change', () => window.api.calSens(Number(sn.value) / 100));
  r = row(k, '');
  const ap = el('button', 'btn wide', '적용');
  ap.addEventListener('click', () => window.api.calApply());
  r.appendChild(ap);
  syncers.push(() => {
    const c = S.cal;
    const run = c.phase !== 'off' && c.phase !== 'done';
    cs.textContent = run ? '취소' : '시작';
    cs.classList.toggle('danger', run);
    cs.disabled = !run && !S.live.connected;
    stepEls.forEach((d, i) => {
      d.classList.toggle('on', run && c.step === i);
      d.classList.toggle('done', (run && c.step > i) || (!run && c.result && c.result.ok));
    });
    count.textContent = run ? (c.left / 1000).toFixed(1) : '';
    const res = c.result;
    const st = res && res.ok ? res.stats : null;
    lines.restHigh.textContent = st ? fmt(st.restHigh, 1) : '--';
    lines.sqTop.textContent = st && st.sqTop != null ? fmt(st.sqTop, 1) : '--';
    lines.th.textContent = S.suggestion ? fmt(S.suggestion.threshold, 1) : '--';
    const msg = res ? (res.error || (res.warnings && res.warnings[0]) || (res.ok && !S.suggestion ? '힘줄 때 신호가 약합니다' : '')) : '';
    warn.textContent = msg;
    warn.title = msg;
    warnRow.hidden = !msg;
    if (document.activeElement !== sr) sr.value = Math.round(S.calSens * 100);
    if (document.activeElement !== sn) sn.value = Math.round(S.calSens * 100);
    ap.disabled = !(res && res.ok);
  });

  // ── 신호 ──
  k = card(c3, '신호');
  seg(k, '채널', [{ label: '1', value: 1, num: true }, { label: '2', value: 2, num: true }], () => S.settings.signal.channel, (v) => window.api.patch({ signal: { channel: v } }));
  seg(k, '전원', [{ label: '60 Hz', value: 60, num: true }, { label: '50 Hz', value: 50, num: true }], () => S.settings.signal.mainsHz, (v) => window.api.patch({ signal: { mainsHz: v } }));
  slider(k, '표시 시간', ['signal', 'seconds'], 0.5, 5, 0.1, 1);
  slider(k, '세로 범위', ['signal', 'scale'], 20, 600, 1, 0);

  // ── 화면 ──
  k = card(c3, '화면');
  slider(k, '크기', ['overlay', 'scale'], 50, 200, 1, 0);
  slider(k, '가로 위치', ['overlay', 'x'], 0, 100, 1, 0);
  slider(k, '세로 위치', ['overlay', 'y'], 0, 100, 1, 0);
  slider(k, '투명도', ['overlay', 'opacity'], 30, 100, 1, 0);
  const mon = row(k, '모니터');
  const box = el('div', 'seg');
  mon.appendChild(box);
  let monKey = '';
  syncers.push(() => {
    const key = S.displays.map((d) => d.index).join(',');
    if (key !== monKey) {
      monKey = key;
      box.textContent = '';
      S.displays.forEach((d, i) => {
        const b = el('button', 'num', String(i + 1));
        b.addEventListener('click', () => window.api.patch({ overlay: { display: i } }));
        box.appendChild(b);
      });
    }
    const cur = Number.isInteger(S.settings.overlay.display) ? S.settings.overlay.display : S.displays.findIndex((d) => d.primary);
    [...box.children].forEach((b, i) => b.classList.toggle('on', i === cur));
  });
  r = row(k, '');
  const dr = el('button', 'btn wide', '화면에서 끌어 정하기');
  dr.addEventListener('click', () => window.api.setDrag(!S.dragMode));
  r.appendChild(dr);
  syncers.push(() => { dr.textContent = S.dragMode ? '끌기 끝내기' : '화면에서 끌어 정하기'; dr.classList.toggle('danger', S.dragMode); });
}

$('#run').addEventListener('click', () => window.api.setRunning(!S.running));

function render(state) {
  S = state;
  const l = S.live;
  const st = $('#status');
  st.classList.toggle('ok', l.connected);
  $('#status-text').textContent = l.connected ? 'SpikerBox ' + l.fps.toLocaleString('en-US') + ' fps' : '장치 없음';
  const run = $('#run');
  run.textContent = S.running ? '가동 정지' : '가동 시작';
  run.classList.toggle('danger', S.running);
  $('#version').textContent = 'v' + S.version;
  syncers.forEach((f) => f());
}

(async () => {
  S = await window.api.getState();
  build();
  render(S);
  window.api.onState(render);
})();
