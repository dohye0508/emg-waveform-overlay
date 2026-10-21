'use strict';

const card = document.getElementById('card');
const canvas = document.getElementById('wave');
const ctx = canvas.getContext('2d');
const chip = document.getElementById('chip');
const chipLabel = document.getElementById('chip-label');
const rmsEl = document.getElementById('rms');
const fill = document.getElementById('fill');
const tick = document.getElementById('tick');
const dragEl = document.getElementById('drag');

// 창 크기에 맞춰 360×176 카드를 통째로 확대·축소한다 (글자·막대가 같이 커진다)
function fit() {
  card.style.transform = 'scale(' + (window.innerWidth / 360) + ')';
}
window.addEventListener('resize', fit);
fit();

function draw(f) {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#16213A';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i++) { ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); }
  ctx.stroke();
  const cols = f.env.length / 2;
  const mid = h / 2;
  const k = (h / 2 - 4) / Math.max(1, f.range);
  ctx.strokeStyle = f.active ? '#FF3D8B' : '#35E0F2';
  ctx.lineWidth = Math.max(1, w / cols - 0.5);
  ctx.beginPath();
  for (let c = 0; c < cols; c++) {
    const x = ((c + 0.5) * w) / cols;
    const lo = Math.max(-h / 2 + 2, Math.min(h / 2 - 2, f.env[c * 2] * k));
    const hi = Math.max(-h / 2 + 2, Math.min(h / 2 - 2, f.env[c * 2 + 1] * k));
    ctx.moveTo(x, mid - hi);
    ctx.lineTo(x, mid - lo + 1);
  }
  ctx.stroke();
}

window.api.onFrame((f) => {
  draw(f);
  card.classList.toggle('active', !!f.active);
  card.classList.toggle('lost', !f.connected);
  chipLabel.textContent = f.keyLabel;
  chip.classList.toggle('on', !!f.pressed);
  rmsEl.textContent = f.connected ? f.rms.toFixed(1) : '--';
  const full = Math.max(0.1, f.threshold * 2);
  fill.style.width = Math.min(100, (f.rms / full) * 100) + '%';
  tick.style.left = '50%';
});

window.api.onDrag((on) => { dragEl.hidden = !on; });
