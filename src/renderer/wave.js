'use strict';

// 설정 화면과 오버레이가 같이 쓰는 그리기 함수 (canvas 2D).
//   envelope: 열마다 (min, max) 로 압축한 파형을 위아래 대칭 채움 + 테두리로 그린다. 왼쪽(오래된 쪽)은 흐려진다.
//   rmsHistory: 최근 몇 초의 구간 RMS 를 선으로, 역치 위로 올라간 부분은 산호색으로 칠한다.

(function () {
  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /** CSS 크기 × 화면 배율에 맞춰 캔버스 해상도를 맞추고, 설계 단위(px)로 그리게 한다 */
  function prep(canvas, scale) {
    const dpr = (window.devicePixelRatio || 1) * (scale || 1);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function grid(ctx, w, h, color, rows) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < rows; i++) {
      const y = Math.round((h * i) / rows) + 0.5;
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 왼쪽 끝을 투명하게 (흘러가 사라지는 느낌) */
  function fadeLeft(ctx, w, h, frac) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createLinearGradient(0, 0, w * frac, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function envelope(ctx, w, h, env, range, color, glow) {
    const cols = env.length / 2;
    if (!cols) return;
    const mid = h / 2;
    const k = (h / 2 - 3) / Math.max(1, range);
    const clip = (v) => Math.max(-mid + 2, Math.min(mid - 2, v * k));
    const xs = (c) => (c / (cols - 1)) * w;

    ctx.save();
    ctx.beginPath();
    for (let c = 0; c < cols; c++) ctx.lineTo(xs(c), mid - Math.max(clip(env[c * 2 + 1]), 0.6));
    for (let c = cols - 1; c >= 0; c--) ctx.lineTo(xs(c), mid - Math.min(clip(env[c * 2]), -0.6));
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, rgba(color, 0.15));
    g.addColorStop(0.5, rgba(color, 0.85));
    g.addColorStop(1, rgba(color, 0.15));
    ctx.fillStyle = g;
    if (glow) { ctx.shadowColor = rgba(color, 0.7); ctx.shadowBlur = 14; }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    fadeLeft(ctx, w, h, 0.22);
  }

  /**
   * @param hist [{t, v}] 시간순
   * @param o { now, span, threshold, release, color, hot, line, label }
   */
  function rmsHistory(ctx, w, h, hist, o) {
    const padT = 10, padB = 8;
    let vmax = Math.max(o.threshold * 2, 1);
    for (const p of hist) if (p.v * 1.15 > vmax) vmax = p.v * 1.15;
    const y = (v) => h - padB - (Math.min(v, vmax) / vmax) * (h - padT - padB);
    const x = (t) => w - ((o.now - t) / o.span) * w;
    const thY = y(o.threshold);
    const relY = y(o.release);

    const pts = hist.filter((p) => o.now - p.t <= o.span + 200);
    if (pts.length > 1) {
      const path = new Path2D();
      pts.forEach((p, i) => (i ? path.lineTo(x(p.t), y(p.v)) : path.moveTo(x(p.t), y(p.v))));
      const area = new Path2D(path);
      area.lineTo(x(pts[pts.length - 1].t), h);
      area.lineTo(x(pts[0].t), h);
      area.closePath();

      const g = ctx.createLinearGradient(0, padT, 0, h);
      g.addColorStop(0, rgba(o.color, 0.35));
      g.addColorStop(1, rgba(o.color, 0.02));
      ctx.fillStyle = g;
      ctx.fill(area);
      ctx.strokeStyle = o.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke(path);

      // 역치 위쪽만 산호색
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, thY);
      ctx.clip();
      const g2 = ctx.createLinearGradient(0, padT, 0, thY);
      g2.addColorStop(0, rgba(o.hot, 0.55));
      g2.addColorStop(1, rgba(o.hot, 0.15));
      ctx.fillStyle = g2;
      ctx.fill(area);
      ctx.strokeStyle = o.hot;
      ctx.shadowColor = rgba(o.hot, 0.8);
      ctx.shadowBlur = 10;
      ctx.stroke(path);
      ctx.restore();
    }
    fadeLeft(ctx, w, h, 0.12);

    // 해제선 (점선), 역치선
    ctx.save();
    ctx.strokeStyle = rgba(o.line, 0.45);
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Math.round(relY) + 0.5); ctx.lineTo(w, Math.round(relY) + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = o.line;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, thY); ctx.lineTo(w, thY); ctx.stroke();
    ctx.restore();

    if (o.label) {
      ctx.save();
      ctx.font = '700 13px Pretendard, sans-serif';
      const tw = ctx.measureText(o.label).width + 14;
      const ty = Math.max(2, Math.min(h - 22, thY - 11));
      ctx.fillStyle = o.line;
      roundRect(ctx, w - tw - 4, ty, tw, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#1A1408';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.label, w - tw + 3, ty + 11.5);
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  window.Wave = { rgba, prep, grid, envelope, rmsHistory };
})();
