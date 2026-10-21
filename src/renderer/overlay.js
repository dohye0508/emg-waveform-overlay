'use strict';

const card = document.getElementById('card');
const canvas = document.getElementById('wave');
const chip = document.getElementById('chip');
const chip2 = document.getElementById('chip2');
const rmsEl = document.getElementById('rms');
const fill = document.getElementById('fill');
const rel = document.getElementById('rel');
const t1 = document.getElementById('t1');
const t2 = document.getElementById('t2');
const dragEl = document.getElementById('drag');

// 창 크기에 맞춰 360×176 카드를 통째로 확대·축소한다 (글자·막대가 같이 커진다)
let scale = 1;
function fit() {
  scale = window.innerWidth / 360;
  card.style.transform = 'scale(' + scale + ')';
}
window.addEventListener('resize', fit);
fit();

let last = null;
let shown = 0;

window.api.onFrame((f) => {
  last = f;
  const two = f.levels === 2;
  // 2단계에서 약하게 = 호박, 세게 = 산호. 1단계는 켜지면 산호
  const warm = two && f.level === 1;
  card.classList.toggle('two', two);
  card.classList.toggle('l1', warm);
  card.classList.toggle('active', !!f.active && !warm);
  card.classList.toggle('lost', !f.connected);
  card.classList.toggle('ok', !!f.connected);
  chip.textContent = f.keyLabel;
  chip2.textContent = f.keyLabel2;
  chip.classList.toggle('on', !!f.pressed && (!two || f.pressedLevel === 1));
  chip.classList.toggle('weak', two);
  chip2.classList.toggle('on', !!f.pressed && two && f.pressedLevel === 2);
  const full = Math.max(0.1, two ? f.threshold2 * 1.3 : f.threshold * 2);
  const pct = (v) => Math.min(100, (v / full) * 100) + '%';
  fill.style.width = pct(f.rms);
  rel.style.left = pct(f.release);
  t1.style.left = pct(f.threshold);
  t2.style.left = pct(f.threshold2);
});

function frame() {
  if (last) {
    shown += ((last.connected ? last.rms : 0) - shown) * 0.3;
    rmsEl.textContent = last.connected ? shown.toFixed(1) : '--';
    const warm = last.levels === 2 && last.level === 1;
    const w = Wave.prep(canvas, scale);
    Wave.grid(w.ctx, w.w, w.h, 'rgba(38, 46, 72, 0.6)', 4);
    Wave.envelope(w.ctx, w.w, w.h, last.env, last.range, warm ? '#F4B860' : last.active ? '#FF8F8F' : '#82B9FF', last.active);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.api.onDrag((on) => { dragEl.hidden = !on; });
