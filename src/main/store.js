'use strict';

// 설정 저장. userData/settings.json 에 임시 파일 → fsync → rename 으로 쓴다 (저장 도중 꺼져도 원본이 안 깨진다).
// normalizeSettings 는 어떤 입력이 와도 범위 안의 완전한 설정을 돌려준다.

const fs = require('fs');
const path = require('path');
const { lookup, normalizeAccelerator } = require('./keymap');

const DEFAULTS = {
  // Ctrl+1 가동, Ctrl+2 오버레이 (v1.1 까지 Ctrl+Alt+F9/F10, v1.2 는 F8/F9 였다)
  hotkeys: { toggle: 'Ctrl+1', overlay: 'Ctrl+2' },
  // levels 2: 약하게 = code, 세게 = code2. decideMs: 약하게 키를 누르기 전에 세게까지 오르는지 기다리는 시간
  key: { code: 'Space', code2: 'ArrowRight', levels: 1, mode: 'hold', tapMs: 30, cooldownMs: 120, decideMs: 150 },
  // 필터 후 쉴 때 RMS ≈ 2~3, 센 힘 15~58 (2026-10-20 실측)
  trigger: { threshold: 10, threshold2: 22, releaseRatio: 0.7, windowMs: 50 },
  signal: { channel: 1, mainsHz: 60, notch: true, highpassHz: 80, seconds: 2, scale: 200 },
  overlay: { x: 98, y: 8, scale: 100, opacity: 95, display: 'primary' },
  // 사용자 모드: 게임마다 누를 키 하나
  // 2단계 게임(인베이더)은 keys = 약하게, keys2 = 세게
  user: { keys: { gd: 'Space', flappy: 'Space', adofai: 'Space', invaders: 'ArrowLeft', stack: 'Space', breakout: 'ArrowLeft', copter: 'Space', jumper: 'ArrowLeft' }, keys2: { invaders: 'ArrowRight', breakout: 'ArrowRight', jumper: 'ArrowRight' } },
};
const OLD_HOTKEYS = { toggle: 'Ctrl+Alt+F9', overlay: 'Ctrl+Alt+F10' };
const PRESET_COUNT = 3;
const VERSION = 2;

function clampNum(v, min, max, def, step) {
  let n = Number(v);
  if (!Number.isFinite(n)) return def;
  n = Math.min(max, Math.max(min, n));
  if (step) n = Math.round(n / step) * step;
  return Math.round(n * 1000) / 1000;
}

/** 프리셋에 담기는 부분을 뺀 나머지까지 포함한 본 설정 */
function normalizeCore(raw, version) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULTS;
  const hk = r.hotkeys || {};
  const key = r.key || {};
  const tr = r.trigger || {};
  const sg = r.signal || {};
  const ov = r.overlay || {};
  let toggle = normalizeAccelerator(hk.toggle) || d.hotkeys.toggle;
  let overlay = normalizeAccelerator(hk.overlay) || d.hotkeys.overlay;
  // 예전 기본 단축키를 그대로 쓰던 설정은 새 기본값으로 (직접 고른 것은 그대로)
  if (version !== VERSION && toggle === OLD_HOTKEYS.toggle && overlay === OLD_HOTKEYS.overlay) {
    toggle = d.hotkeys.toggle;
    overlay = d.hotkeys.overlay;
  }
  if (overlay === toggle) overlay = toggle === d.hotkeys.overlay ? d.hotkeys.toggle : d.hotkeys.overlay;
  const threshold = clampNum(tr.threshold, 0.5, 500, d.trigger.threshold);
  let threshold2 = clampNum(tr.threshold2, 0.5, 500, Math.max(d.trigger.threshold2, threshold * 1.5));
  if (threshold2 <= threshold) threshold2 = Math.round(threshold * 1.5 * 10) / 10; // 세게 역치는 약하게 역치보다 위
  const code = lookup(key.code) ? key.code : d.key.code;
  let code2 = lookup(key.code2) ? key.code2 : d.key.code2;
  if (code2 === code) code2 = code === d.key.code2 ? 'ArrowLeft' : d.key.code2;
  return {
    hotkeys: { toggle, overlay },
    key: {
      code,
      code2,
      levels: Number(key.levels) === 2 ? 2 : 1,
      mode: key.mode === 'tap' ? 'tap' : 'hold',
      tapMs: clampNum(key.tapMs, 10, 300, d.key.tapMs, 1),
      cooldownMs: clampNum(key.cooldownMs, 0, 1000, d.key.cooldownMs, 1),
      decideMs: clampNum(key.decideMs, 0, 500, d.key.decideMs, 1),
    },
    trigger: {
      threshold,
      threshold2,
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
    user: {
      keys: Object.fromEntries(Object.keys(d.user.keys).map((g) => {
        const k = r.user && r.user.keys && r.user.keys[g];
        return [g, lookup(k) && k !== 'Escape' ? k : d.user.keys[g]];
      })),
      keys2: Object.fromEntries(Object.keys(d.user.keys2).map((g) => {
        const k = r.user && r.user.keys2 && r.user.keys2[g];
        const weak = lookup(r.user && r.user.keys && r.user.keys[g]) ? r.user.keys[g] : d.user.keys[g];
        const ok = lookup(k) && k !== 'Escape' && k !== weak;
        return [g, ok ? k : d.user.keys2[g] !== weak ? d.user.keys2[g] : d.user.keys[g]];
      })),
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

/** 프리셋에 담는 것: 단축키를 뺀 전부 (키·역치·신호·오버레이 위치) */
function presetOf(core) {
  return JSON.parse(JSON.stringify({ key: core.key, trigger: core.trigger, signal: core.signal, overlay: core.overlay }));
}

function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const core = normalizeCore(r, r.v);
  const list = Array.isArray(r.presets) ? r.presets : [];
  const presets = [];
  for (let i = 0; i < PRESET_COUNT; i++) {
    const p = list[i];
    presets.push(p && p.data && typeof p.data === 'object' ? { data: presetOf(normalizeCore(merge(core, p.data), VERSION)) } : { data: null });
  }
  let active = Number.isInteger(r.activePreset) && r.activePreset >= 0 && r.activePreset < PRESET_COUNT ? r.activePreset : 0;
  // 지금 고른 프리셋은 항상 지금 설정과 같다 (처음 쓰는 칸이면 지금 설정을 담는다)
  presets[active] = { data: presetOf(core) };
  return { v: VERSION, ...core, presets, activePreset: active };
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

module.exports = { DEFAULTS, PRESET_COUNT, normalizeSettings, presetOf, merge, Store, writeJsonAtomic };
