'use strict';

// 오버레이 창 위치·크기 계산 (화면 단위 % ↔ 픽셀), 파형 압축. 화면(Electron)을 몰라서 테스트할 수 있다.

const BASE_W = 360;
const BASE_H = 176;
const MIN_SCALE = 50;
const MAX_SCALE = 200;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 작업 영역 + (x%, y%, 크기%) → 창 위치·크기. x=0 은 왼쪽 끝, 100 은 오른쪽 끝에 붙는다 (창이 화면 밖으로 안 나간다). */
function overlayBounds(workArea, xPct, yPct, scalePct) {
  const s = clamp(scalePct, MIN_SCALE, MAX_SCALE) / 100;
  const width = Math.round(BASE_W * s);
  const height = Math.round(BASE_H * s);
  const freeX = Math.max(0, workArea.width - width);
  const freeY = Math.max(0, workArea.height - height);
  return {
    x: workArea.x + Math.round((clamp(xPct, 0, 100) / 100) * freeX),
    y: workArea.y + Math.round((clamp(yPct, 0, 100) / 100) * freeY),
    width,
    height,
  };
}

/** 창 위치·크기 → (x%, y%, 크기%) (끌어서 정한 뒤 저장할 때) */
function settingsFromBounds(workArea, bounds) {
  const scale = clamp(Math.round((bounds.width / BASE_W) * 100), MIN_SCALE, MAX_SCALE);
  const s = scale / 100;
  const width = Math.round(BASE_W * s);
  const height = Math.round(BASE_H * s);
  const freeX = workArea.width - width;
  const freeY = workArea.height - height;
  const pct = (v, free) => (free > 0 ? clamp(Math.round((v / free) * 100), 0, 100) : 0);
  return { x: pct(bounds.x - workArea.x, freeX), y: pct(bounds.y - workArea.y, freeY), scale };
}

/** 최근 샘플 n 개를 columns 열로 나눠 열마다 (min, max). 샘플이 모자라면 오른쪽에 맞추고 왼쪽은 0. */
class SampleRing {
  constructor(capacity) {
    this.buf = new Float32Array(capacity);
    this.cap = capacity;
    this.pos = 0; // 다음에 쓸 자리
    this.size = 0;
  }

  push(values) {
    for (let i = 0; i < values.length; i++) {
      this.buf[this.pos] = values[i];
      this.pos = (this.pos + 1) % this.cap;
    }
    this.size = Math.min(this.cap, this.size + values.length);
  }

  clear() {
    this.pos = 0;
    this.size = 0;
  }

  /** 맨 오래된 것부터 i 번째 (0 = size 개 중 가장 오래됨) */
  at(i) {
    return this.buf[(this.pos - this.size + i + this.cap * 2) % this.cap];
  }

  envelope(n, columns) {
    const out = new Float32Array(columns * 2);
    n = Math.max(1, Math.min(n, this.cap));
    const start = this.size - n; // 음수면 앞이 비어 있다
    for (let c = 0; c < columns; c++) {
      const lo = start + Math.floor((c * n) / columns);
      const hi = start + Math.max(Math.floor(((c + 1) * n) / columns), Math.floor((c * n) / columns) + 1);
      let mn = Infinity, mx = -Infinity;
      for (let i = Math.max(lo, 0); i < hi && i < this.size; i++) {
        const v = this.at(i);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      out[c * 2] = mn === Infinity ? 0 : mn;
      out[c * 2 + 1] = mx === -Infinity ? 0 : mx;
    }
    return out;
  }
}

module.exports = { BASE_W, BASE_H, MIN_SCALE, MAX_SCALE, overlayBounds, settingsFromBounds, SampleRing };
