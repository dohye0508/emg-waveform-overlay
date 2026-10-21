'use strict';

// 설정 저장. userData/settings.json 에 임시 파일 → fsync → rename 으로 쓴다 (저장 도중 꺼져도 원본이 안 깨진다).
// normalizeSettings 는 어떤 입력이 와도 범위 안의 완전한 설정을 돌려준다.

const fs = require('fs');
const path = require('path');
const { lookup } = require('./keymap');
const { normalizeAccelerator } = require('./keymap');

const DEFAULTS = {
  hotkeys: { toggle: 'Ctrl+Alt+F9', overlay: 'Ctrl+Alt+F10' },
  key: { code: 'Space', mode: 'hold', tapMs: 30, cooldownMs: 120 },
  // 필터 후 쉴 때 RMS ≈ 2~3, 센 힘 15~58 (2026-10-20 실측)
  trigger: { threshold: 10, releaseRatio: 0.7, windowMs: 50 },
  signal: { channel: 1, mainsHz: 60, notch: true, highpassHz: 80, seconds: 2, scale: 200 },
  overlay: { x: 98, y: 8, scale: 100, opacity: 95, display: 'primary' },
};

function clampNum(v, min, max, def, step) {
  let n = Number(v);
  if (!Number.isFinite(n)) return def;
  n = Math.min(max, Math.max(min, n));
  if (step) n = Math.round(n / step) * step;
  return Math.round(n * 1000) / 1000;
}

function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULTS;
  const hk = r.hotkeys || {};
  const key = r.key || {};
  const tr = r.trigger || {};
  const sg = r.signal || {};
  const ov = r.overlay || {};
  const toggle = normalizeAccelerator(hk.toggle) || d.hotkeys.toggle;
  let overlay = normalizeAccelerator(hk.overlay) || d.hotkeys.overlay;
  if (overlay === toggle) overlay = toggle === d.hotkeys.overlay ? d.hotkeys.toggle : d.hotkeys.overlay;
  return {
    hotkeys: { toggle, overlay },
    key: {
      code: lookup(key.code) ? key.code : d.key.code,
      mode: key.mode === 'tap' ? 'tap' : 'hold',
      tapMs: clampNum(key.tapMs, 10, 300, d.key.tapMs, 1),
      cooldownMs: clampNum(key.cooldownMs, 0, 1000, d.key.cooldownMs, 1),
    },
    trigger: {
      threshold: clampNum(tr.threshold, 0.5, 500, d.trigger.threshold),
      releaseRatio: clampNum(tr.releaseRatio, 0.4, 0.95, d.trigger.releaseRatio),
      windowMs: clampNum(tr.windowMs, 25, 200, d.trigger.windowMs, 5),
    },
    signal: {
      channel: Number(sg.channel) === 2 ? 2 : 1,
      mainsHz: Number(sg.mainsHz) === 50 ? 50 : 60,
      notch: sg.notch !== false,
      highpassHz: clampNum(sg.highpassHz, 0, 200, d.signal.highpassHz, 1),
      seconds: clampNum(sg.seconds, 0.5, 5, d.signal.seconds),
      scale: clampNum(sg.scale, 20, 600, d.signal.scale, 1),
    },
    overlay: {
      x: clampNum(ov.x, 0, 100, d.overlay.x, 1),
      y: clampNum(ov.y, 0, 100, d.overlay.y, 1),
      scale: clampNum(ov.scale, 50, 200, d.overlay.scale, 1),
      opacity: clampNum(ov.opacity, 30, 100, d.overlay.opacity, 1),
      display: Number.isInteger(ov.display) ? ov.display : 'primary',
    },
  };
}

/** 객체를 깊게 합친다 (patch 의 값이 이긴다). 배열은 통째로 바꾼다. */
function merge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const k of Object.keys(patch)) out[k] = merge(out[k], patch[k]);
  return out;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Windows 에서는 백신 등이 파일을 잠깐 잡고 있으면 rename 이 EPERM/EBUSY 로 실패할 수 있어 몇 번 재시도
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (i >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(30 * (i + 1));
    }
  }
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'settings.json');
  }

  load() {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // 깨진 파일은 옆으로 치워 두고 기본값으로 시작
        console.error('[store] 설정 파일을 읽지 못해 기본값을 씁니다:', err.message);
        try { fs.renameSync(this.file, this.file + '.corrupt-' + Date.now()); } catch (_) { /* ignore */ }
      }
    }
    return normalizeSettings(parsed);
  }

  save(settings) {
    writeJsonAtomic(this.file, settings);
  }
}

module.exports = { DEFAULTS, normalizeSettings, merge, Store, writeJsonAtomic };
