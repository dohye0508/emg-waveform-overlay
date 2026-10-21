'use strict';

const card = document.getElementById('card');
const canvas = document.getElementById('wave');
const chip = document.getElementById('chip');
const rmsEl = document.getElementById('rms');
const fill = document.getElementById('fill');
const rel = document.getElementById('rel');
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
  card.classList.toggle('active', !!f.active);
  card.classList.toggle('lost', !f.connected);
  card.classList.toggle('ok', !!f.connected);
  chip.textContent = f.keyLabel;
  chip.classList.toggle('on', !!f.pressed);
  const full = Math.max(0.1, f.threshold * 2);
  fill.style.width = Math.min(100, (f.rms / full) * 100) + '%';
  rel.style.left = Math.min(100, (f.release / full) * 100) + '%';
});

function frame() {
  if (last) {
    shown += ((last.connected ? last.rms : 0) - shown) * 0.3;
    rmsEl.textContent = last.connected ? shown.toFixed(1) : '--';
    const w = Wave.prep(canvas, scale);
    Wave.grid(w.ctx, w.w, w.h, 'rgba(38, 46, 72, 0.6)', 4);
    Wave.envelope(w.ctx, w.w, w.h, last.env, last.range, last.active ? '#FF8F8F' : '#82B9FF', last.active);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.api.onDrag((on) => { dragEl.hidden = !on; });
