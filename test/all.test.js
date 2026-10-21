'use strict';

// node test/all.test.js — 장치·Electron·Windows 없이 엔진, 키맵, 설정, 화면 계산, 장치 연결, 자동 설정을 검사한다.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { KeyEngine } = require('../src/main/engine');
const keymap = require('../src/main/keymap');
const layout = require('../src/main/layout');
const { normalizeSettings, merge, Store, DEFAULTS } = require('../src/main/store');
const hid = require('../src/main/hid');
const { HidInput } = require('../src/main/hidinput');
const { EmgWindow, EmgFilter } = require('../src/main/emg');
const { analyzeCalibration, AutoCal, suggestThreshold, STEPS } = require('../src/main/calib');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name);
    throw err;
  }
}

// ───────────── 키 눌림 엔진 ─────────────
function makeEngine(cfg) {
  const log = [];
  const e = new KeyEngine({ send: (a, c) => log.push(a + ':' + c) });
  e.configure({ threshold: 10, releaseRatio: 0.7, mode: 'hold', tapMs: 30, cooldownMs: 120, code: 'Space', ...cfg });
  return { e, log };
}

test('엔진 hold: 역치를 넘으면 누르고, 해제선 아래로 내려가야 뗀다 (그 사이는 유지)', () => {
  const { e, log } = makeEngine();
  e.setEnabled(true, 0);
  e.update(5, 100);
  assert.deepStrictEqual(log, []);
  e.update(10, 150); // 역치와 같으면 켜짐
  assert.deepStrictEqual(log, ['down:Space']);
  e.update(8, 200); // 해제선(7) 위: 유지
  assert.deepStrictEqual(log, ['down:Space']);
  e.update(6.9, 250);
  assert.deepStrictEqual(log, ['down:Space', 'up:Space']);
  assert.strictEqual(e.state.pressed, false);
});

test('엔진 tap: 켜질 때 tapMs 만 눌렀다 떼고, 꺼진 뒤 쿨다운이 지나야 다시 누른다', () => {
  const { e, log } = makeEngine({ mode: 'tap', tapMs: 30, cooldownMs: 120 });
  e.setEnabled(true, 0);
  e.update(20, 1000);
  assert.deepStrictEqual(log, ['down:Space']);
  e.tick(1020);
  assert.strictEqual(log.length, 1); // 아직 30 ms 전
  e.tick(1031);
  assert.deepStrictEqual(log, ['down:Space', 'up:Space']);
  e.update(2, 1040); // 꺼짐
  e.update(20, 1100); // 뗀 지 69 ms: 쿨다운 안이라 무시
  assert.strictEqual(log.length, 2);
  e.update(2, 1110);
  e.update(20, 1200); // 뗀 지 169 ms
  assert.deepStrictEqual(log, ['down:Space', 'up:Space', 'down:Space']);
  e.tick(1240);
  assert.strictEqual(log[log.length - 1], 'up:Space');
});

test('엔진: 정지(가동 끔) 중에는 키를 보내지 않고, 눌린 채로 끄면 뗀다', () => {
  const { e, log } = makeEngine();
  e.update(30, 0); // 정지 중에도 켜짐 상태는 계산한다 (미리보기)
  assert.strictEqual(e.state.active, true);
  assert.deepStrictEqual(log, []);
  e.setEnabled(true, 10); // 이미 힘이 들어가 있는 채로 가동하면 바로 누른다
  assert.deepStrictEqual(log, ['down:Space']);
  e.setEnabled(false, 20);
  assert.deepStrictEqual(log, ['down:Space', 'up:Space']);
});

test('엔진 시험 모드: 키를 보내지 않고 칩 상태만 바뀐다, 눌린 채로 시험 모드가 되면 실제 키를 뗀다', () => {
  const { e, log } = makeEngine();
  e.setEnabled(true, 0);
  e.setTest(true);
  e.update(20, 100);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(e.state.pressed, true);
  e.update(1, 200);
  assert.strictEqual(e.state.pressed, false);
  e.setTest(false);
  e.update(20, 300);
  assert.deepStrictEqual(log, ['down:Space']);
  e.setTest(true);
  assert.deepStrictEqual(log, ['down:Space', 'up:Space']);
});

test('엔진: 신호 끊김·키/방식 변경·releaseAll 때 눌린 키를 뗀다 (바꾸기 전 키를 뗀다)', () => {
  const a = makeEngine();
  a.e.setEnabled(true, 0);
  a.e.update(20, 10);
  a.e.signalLost();
  assert.deepStrictEqual(a.log, ['down:Space', 'up:Space']);
  assert.strictEqual(a.e.state.active, false);

  const b = makeEngine();
  b.e.setEnabled(true, 0);
  b.e.update(20, 10);
  b.e.configure({ code: 'KeyA' });
  assert.deepStrictEqual(b.log, ['down:Space', 'up:Space']); // 옛 키를 뗐다
  b.e.update(1, 20);
  b.e.update(20, 30);
  assert.strictEqual(b.log[b.log.length - 1], 'down:KeyA');
  b.e.releaseAll();
  assert.strictEqual(b.log[b.log.length - 1], 'up:KeyA');
});

function two(cfg) {
  return makeEngine({ levels: 2, threshold: 10, threshold2: 25, code: 'ArrowLeft', code2: 'ArrowRight', decideMs: 150, ...cfg });
}

test('2단계 hold: 약하게는 판정 시간 뒤에 왼쪽, 세게까지 오르면 바로 오른쪽 (왼쪽은 안 눌림)', () => {
  const a = two();
  a.e.setEnabled(true, 0);
  a.e.update(15, 1000); // 약하게 구간
  a.e.tick(1100);
  assert.deepStrictEqual(a.log, []); // 아직 판정 중
  a.e.tick(1150);
  assert.deepStrictEqual(a.log, ['down:ArrowLeft']);
  a.e.update(2, 1300);
  assert.deepStrictEqual(a.log, ['down:ArrowLeft', 'up:ArrowLeft']);

  const b = two();
  b.e.setEnabled(true, 0);
  b.e.update(15, 1000); // 세게 주는 도중 약하게 구간을 지난다
  b.e.update(30, 1050);
  b.e.tick(1200);
  assert.deepStrictEqual(b.log, ['down:ArrowRight']);
  assert.strictEqual(b.e.state.pressedLevel, 2);
});

test('2단계 hold: 세게에서 힘을 빼며 약하게 구간을 지날 때 왼쪽을 누르지 않는다, 약하게→세게로 올리면 바꿔 누른다', () => {
  const a = two();
  a.e.setEnabled(true, 0);
  a.e.update(30, 0);
  a.e.update(15, 100); // 25×0.7=17.5 아래로: 약하게 단계로 내려옴
  a.e.tick(400);
  assert.deepStrictEqual(a.log, ['down:ArrowRight', 'up:ArrowRight']);
  a.e.update(2, 500);
  a.e.update(15, 600); // 쉼을 거쳤으니 다시 판정
  a.e.tick(800);
  assert.deepStrictEqual(a.log.slice(2), ['down:ArrowLeft']);
  a.e.update(30, 900);
  assert.deepStrictEqual(a.log.slice(2), ['down:ArrowLeft', 'up:ArrowLeft', 'down:ArrowRight']);
});

test('2단계 tap: 짧게 약하게 → 왼쪽 한 번, 세게 → 오른쪽 한 번, 쉼으로 돌아와야 다음 탭', () => {
  const a = two({ mode: 'tap', tapMs: 30, cooldownMs: 0 });
  a.e.setEnabled(true, 0);
  a.e.update(15, 1000);
  a.e.update(2, 1080); // 판정 시간 안에 힘을 뺐다 → 약하게
  assert.deepStrictEqual(a.log, ['down:ArrowLeft']);
  a.e.tick(1111);
  assert.deepStrictEqual(a.log, ['down:ArrowLeft', 'up:ArrowLeft']);
  a.e.update(15, 1200);
  a.e.update(30, 1250); // 세게
  assert.deepStrictEqual(a.log.slice(2), ['down:ArrowRight']);
  a.e.tick(1290);
  a.e.update(15, 1300); // 내려오는 중: 탭 없음
  a.e.tick(1600);
  assert.deepStrictEqual(a.log.slice(2), ['down:ArrowRight', 'up:ArrowRight']);
  a.e.update(2, 1700);
  a.e.update(15, 1800);
  a.e.tick(1960); // 판정 시간이 지나도 세게가 아니면 약하게
  assert.deepStrictEqual(a.log.slice(4), ['down:ArrowLeft']);
});

test('2단계: 판정 중에 정지·신호 끊김이면 아무 키도 안 누른다, 1단계로 바꾸면 눌린 키를 뗀다', () => {
  const a = two();
  a.e.setEnabled(true, 0);
  a.e.update(15, 0);
  a.e.signalLost();
  a.e.tick(500);
  assert.deepStrictEqual(a.log, []);
  a.e.update(30, 600);
  a.e.configure({ levels: 1 });
  assert.deepStrictEqual(a.log, ['down:ArrowRight', 'up:ArrowRight']);
});

// ───────────── 키맵 ─────────────
test('키맵: 스캔코드와 확장 키, 이름 표시', () => {
  assert.deepStrictEqual(keymap.lookup('Space'), { sc: 0x39, ext: false });
  assert.deepStrictEqual(keymap.lookup('KeyA'), { sc: 0x1e, ext: false });
  assert.deepStrictEqual(keymap.lookup('KeyZ'), { sc: 0x2c, ext: false });
  assert.deepStrictEqual(keymap.lookup('Digit0'), { sc: 0x0b, ext: false });
  assert.deepStrictEqual(keymap.lookup('F12'), { sc: 0x58, ext: false });
  assert.deepStrictEqual(keymap.lookup('ArrowUp'), { sc: 0x48, ext: true });
  assert.deepStrictEqual(keymap.lookup('ControlRight'), { sc: 0x1d, ext: true });
  assert.strictEqual(keymap.lookup('ControlLeft').ext, false);
  assert.strictEqual(keymap.lookup('NoSuchKey'), null);
  assert.strictEqual(keymap.lookup('toString'), null);
  assert.strictEqual(keymap.label('Space'), 'SPACE');
  assert.strictEqual(keymap.label('KeyQ'), 'Q');
  assert.strictEqual(keymap.label('Digit5'), '5');
  assert.strictEqual(keymap.label('ArrowLeft'), 'LEFT');
});

test('마우스 버튼: 코드 조회, 이름 표시, 설정에 저장되고 약·강이 같으면 하나를 바꾼다', () => {
  assert.deepStrictEqual(keymap.lookup('MouseLeft'), { mouse: { down: 0x0002, up: 0x0004, data: 0 } });
  assert.strictEqual(keymap.lookup('MouseRight').mouse.down, 0x0008);
  assert.strictEqual(keymap.lookup('MouseForward').mouse.data, 2);
  assert.strictEqual(keymap.lookup('MouseBack').mouse.data, 1);
  assert.deepStrictEqual(keymap.MOUSE_BY_BUTTON, ['MouseLeft', 'MouseMiddle', 'MouseRight', 'MouseBack', 'MouseForward']);
  assert.strictEqual(keymap.label('MouseLeft'), '좌클릭');
  assert.strictEqual(keymap.label('MouseBack'), '뒤로');
  const s = normalizeSettings({ key: { code: 'MouseLeft', code2: 'MouseRight', levels: 2 } });
  assert.deepStrictEqual([s.key.code, s.key.code2], ['MouseLeft', 'MouseRight']);
  const same = normalizeSettings({ key: { code: 'MouseLeft', code2: 'MouseLeft', levels: 2 } });
  assert.notStrictEqual(same.key.code, same.key.code2);
  // 엔진은 마우스 코드도 키와 똑같이 누르고 뗀다
  const { e, log } = makeEngine({ code: 'MouseLeft' });
  e.setEnabled(true, 0);
  e.update(20, 1);
  e.update(1, 2);
  assert.deepStrictEqual(log, ['down:MouseLeft', 'up:MouseLeft']);
});

test('단축키: 이벤트 → 문자열 (모디파이어 순서 고정, 모디파이어만/글자 단독은 거부, F키 단독은 허용)', () => {
  assert.strictEqual(keymap.acceleratorFromEvent({ code: 'F9', ctrlKey: true, altKey: true }), 'Ctrl+Alt+F9');
  assert.strictEqual(keymap.acceleratorFromEvent({ code: 'KeyS', shiftKey: true, ctrlKey: true }), 'Ctrl+Shift+S');
  assert.strictEqual(keymap.acceleratorFromEvent({ code: 'F8' }), 'F8');
  assert.strictEqual(keymap.acceleratorFromEvent({ code: 'KeyS' }), null);
  assert.strictEqual(keymap.acceleratorFromEvent({ code: 'ControlLeft', ctrlKey: true }), null);
  assert.strictEqual(keymap.acceleratorFromEvent({ code: 'ArrowUp', altKey: true }), 'Alt+Up');
  assert.strictEqual(keymap.acceleratorFromEvent({ code: 'Numpad1', ctrlKey: true }), null);
  assert.strictEqual(keymap.normalizeAccelerator('alt + ctrl + f9'), 'Ctrl+Alt+F9');
  assert.strictEqual(keymap.normalizeAccelerator('Ctrl+Nope'), null);
  assert.strictEqual(keymap.normalizeAccelerator('A'), null);
  assert.strictEqual(keymap.acceleratorLabel('Ctrl+Alt+F9'), 'Ctrl + Alt + F9');
});

// ───────────── 화면 계산 ─────────────
test('오버레이 위치·크기: % ↔ 픽셀 왕복, 화면 밖으로 안 나간다', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const b = layout.overlayBounds(wa, 100, 0, 100);
  assert.deepStrictEqual(b, { x: 1920 - 360, y: 0, width: 360, height: 176 });
  const c = layout.overlayBounds(wa, 50, 100, 200);
  assert.strictEqual(c.width, 720);
  assert.strictEqual(c.x + c.width <= 1920 && c.y + c.height <= 1040, true);
  assert.strictEqual(c.y + c.height, 1040);
  const wa2 = { x: 1920, y: 100, width: 1280, height: 720 }; // 두 번째 모니터
  const d = layout.overlayBounds(wa2, 0, 0, 100);
  assert.deepStrictEqual([d.x, d.y], [1920, 100]);
  for (const [x, y, s] of [[0, 0, 50], [100, 100, 200], [37, 62, 123], [98, 8, 100]]) {
    const bb = layout.overlayBounds(wa, x, y, s);
    const back = layout.settingsFromBounds(wa, bb);
    assert.ok(Math.abs(back.x - x) <= 1 && Math.abs(back.y - y) <= 1 && back.scale === s, JSON.stringify({ x, y, s, back }));
  }
  assert.strictEqual(layout.overlayBounds(wa, 0, 0, 999).width, 720); // 크기는 50~200 으로 자른다
  assert.strictEqual(layout.overlayBounds({ x: 0, y: 0, width: 300, height: 100 }, 100, 100, 100).x, 0); // 화면이 작으면 0
});

test('파형 압축: 열마다 min/max, 샘플이 모자라면 오른쪽에 맞춘다, 링이 한 바퀴 돌아도 맞다', () => {
  const ring = new layout.SampleRing(8);
  ring.push([1, 5, -3, 2, 9, -7, 1, 1]);
  assert.deepStrictEqual([...ring.envelope(8, 4)], [1, 5, -3, 2, -7, 9, 1, 1]);
  ring.push([4, 4]); // 맨 앞 두 개(1, 5)가 밀려난다
  assert.deepStrictEqual([...ring.envelope(8, 4)], [-3, 2, -7, 9, 1, 1, 4, 4].reduce((a, v, i, arr) => (i % 2 ? a : a.concat([Math.min(v, arr[i + 1]), Math.max(v, arr[i + 1])])), []));
  const r2 = new layout.SampleRing(100);
  r2.push([7, 7, 7, 7]);
  const env = [...r2.envelope(10, 5)];
  assert.deepStrictEqual(env.slice(0, 6), [0, 0, 0, 0, 0, 0]); // 앞쪽은 비어 있다
  assert.deepStrictEqual(env.slice(-2), [7, 7]);
  assert.strictEqual(env.length, 10);
});

// ───────────── 설정 ─────────────
test('설정 정리: 범위로 자르고, 잘못된 값은 기본값, 같은 단축키는 막는다', () => {
  const d = normalizeSettings(null);
  assert.deepStrictEqual(d, normalizeSettings(d)); // 두 번 정리해도 같다
  assert.strictEqual(d.hotkeys.toggle, 'Ctrl+1');
  assert.strictEqual(d.hotkeys.overlay, 'Ctrl+2');
  const s = normalizeSettings({
    key: { code: 'Nope', mode: 'x', tapMs: 9999, cooldownMs: -5 },
    trigger: { threshold: 'abc', releaseRatio: 5, windowMs: 33 },
    signal: { channel: 3, mainsHz: 55, highpassHz: 999, seconds: 0, scale: 1 },
    overlay: { x: -10, y: 500, scale: 10, opacity: 0, display: 'banana' },
    hotkeys: { toggle: 'Ctrl+Alt+F5', overlay: 'alt+ctrl+f5' },
  });
  assert.strictEqual(s.key.code, 'Space');
  assert.strictEqual(s.key.mode, 'hold');
  assert.strictEqual(s.key.tapMs, 300);
  assert.strictEqual(s.key.cooldownMs, 0);
  assert.strictEqual(s.trigger.threshold, DEFAULTS.trigger.threshold);
  assert.strictEqual(s.trigger.releaseRatio, 0.95);
  assert.strictEqual(s.trigger.windowMs, 35);
  assert.deepStrictEqual([s.signal.channel, s.signal.mainsHz, s.signal.highpassHz, s.signal.seconds, s.signal.scale], [1, 60, 200, 0.5, 20]);
  assert.deepStrictEqual([s.overlay.x, s.overlay.y, s.overlay.scale, s.overlay.opacity, s.overlay.display], [0, 100, 50, 30, 'primary']);
  assert.notStrictEqual(s.hotkeys.toggle, s.hotkeys.overlay);
});

test('설정 병합과 저장: 일부만 바꿔도 나머지는 유지, 다시 읽어도 같고, 깨진 파일은 기본값', () => {
  const base = normalizeSettings(null);
  const next = normalizeSettings(merge(base, { trigger: { threshold: 14.3 }, overlay: { scale: 120 } }));
  assert.strictEqual(next.trigger.threshold, 14.3);
  assert.strictEqual(next.trigger.releaseRatio, base.trigger.releaseRatio);
  assert.strictEqual(next.overlay.scale, 120);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emgov-'));
  const store = new Store(dir);
  assert.deepStrictEqual(store.load(), base); // 파일이 없으면 기본값
  store.save(next);
  assert.deepStrictEqual(new Store(dir).load(), next);
  fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
  assert.deepStrictEqual(new Store(dir).load(), base);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('settings.json.corrupt-')));
});

test('설정: 예전 기본 단축키(Ctrl+Alt+F9/F10)는 F8/F9 로 바뀌고, 직접 고른 단축키는 그대로', () => {
  const old = normalizeSettings({ hotkeys: { toggle: 'Ctrl+Alt+F9', overlay: 'Ctrl+Alt+F10' } });
  assert.deepStrictEqual(old.hotkeys, { toggle: 'Ctrl+1', overlay: 'Ctrl+2' });
  const mine = normalizeSettings({ hotkeys: { toggle: 'Ctrl+Shift+S', overlay: 'F4' } });
  assert.deepStrictEqual(mine.hotkeys, { toggle: 'Ctrl+Shift+S', overlay: 'F4' });
  // 새 판에서 다시 Ctrl+Alt+F9 를 고르면 그대로 둔다
  const again = normalizeSettings({ v: 2, hotkeys: { toggle: 'Ctrl+Alt+F9', overlay: 'Ctrl+Alt+F10' } });
  assert.strictEqual(again.hotkeys.toggle, 'Ctrl+Alt+F9');
});

test('설정: 세게 역치는 약하게보다 위, 두 키는 서로 다르다', () => {
  const s = normalizeSettings({ trigger: { threshold: 30, threshold2: 20 }, key: { code: 'ArrowRight', code2: 'ArrowRight', levels: 2 } });
  assert.ok(s.trigger.threshold2 > s.trigger.threshold);
  assert.notStrictEqual(s.key.code, s.key.code2);
  assert.strictEqual(s.key.levels, 2);
});

test('프리셋: 3칸, 지금 칸은 지금 설정과 같고, 칸을 바꾸면 그 칸 설정이 불러와진다, 빈 칸은 지금 설정으로 시작', () => {
  let s = normalizeSettings(null);
  assert.strictEqual(s.presets.length, 3);
  assert.strictEqual(s.activePreset, 0);
  assert.strictEqual(s.presets[0].data.trigger.threshold, s.trigger.threshold);
  assert.strictEqual(s.presets[1].data, null);
  // 칸 0 에서 역치를 바꾸면 칸 0 에 같이 저장된다
  s = normalizeSettings(merge(s, { trigger: { threshold: 12 } }));
  assert.strictEqual(s.presets[0].data.trigger.threshold, 12);
  // 빈 칸 1 로: 지금 설정을 그대로 담는다
  s = normalizeSettings({ ...s, activePreset: 1 });
  assert.strictEqual(s.presets[1].data.trigger.threshold, 12);
  // 칸 1 에서 2단계·다른 키로 바꾼다
  s = normalizeSettings(merge(s, { key: { levels: 2, code: 'ArrowLeft', code2: 'ArrowRight' }, trigger: { threshold: 8 } }));
  // 칸 0 으로 돌아가면 칸 0 설정 (1단계, 역치 12)
  const sel = (st, i) => normalizeSettings({ ...merge(st, st.presets[i].data || {}), activePreset: i });
  s = sel(s, 0);
  assert.deepStrictEqual([s.key.levels, s.key.code, s.trigger.threshold], [1, 'Space', 12]);
  s = sel(s, 1);
  assert.deepStrictEqual([s.key.levels, s.key.code, s.key.code2, s.trigger.threshold], [2, 'ArrowLeft', 'ArrowRight', 8]);
  // 단축키는 프리셋에 안 담긴다
  assert.strictEqual(s.presets[1].data.hotkeys, undefined);
  // 깨진 프리셋은 빈 칸
  assert.strictEqual(normalizeSettings({ presets: [null, 'x', { data: 5 }] }).presets[2].data, null);
});

test('사용자 모드: 게임 목록, 게임별 키 저장(Esc·없는 키는 기본값), 게임 중 엔진은 1단계 + 게임 방식', () => {
  const games = require('../src/main/games');
  assert.deepStrictEqual(games.GAMES.map((g) => g.id), ['gd', 'flappy', 'adofai']);
  const ad = games.gameById('adofai');
  assert.deepStrictEqual([ad.native, ad.windowTitle, ad.launchUrl, ad.exitAccel, ad.mode], [true, 'A Dance of Fire and Ice', 'steam://rungameid/977950', 'Ctrl+Q', 'tap']);
  assert.strictEqual(games.gameById('gd').url, 'https://www.geometrydash.com/game/index.html');
  assert.strictEqual(games.gameById('nope'), null);
  const s = normalizeSettings({ user: { keys: { gd: 'Escape', flappy: 'MouseLeft' } }, key: { levels: 2, code: 'ArrowLeft', mode: 'tap' }, trigger: { threshold: 12 } });
  assert.deepStrictEqual(s.user.keys, { gd: 'Space', flappy: 'MouseLeft', adofai: 'Space' });
  assert.strictEqual(normalizeSettings({ user: { keys: { gd: 'Nope' } } }).user.keys.gd, 'Space');
  const gd = games.engineConfigFor(games.gameById('gd'), s);
  assert.deepStrictEqual([gd.levels, gd.mode, gd.code, gd.threshold], [1, 'hold', 'Space', 12]);
  const fb = games.engineConfigFor(games.gameById('flappy'), s);
  assert.deepStrictEqual([fb.levels, fb.mode, fb.code], [1, 'tap', 'MouseLeft']);
  // 사용자 키는 프리셋에 안 담긴다
  assert.strictEqual(s.presets[0].data.user, undefined);
});

test('게임 창에 넣을 입력: 키는 Electron keyCode, 마우스 왼·오·가운데는 버튼, 넣을 수 없는 키는 null', () => {
  assert.deepStrictEqual(keymap.injectOf('Space'), { kind: 'key', keyCode: 'Space' });
  assert.deepStrictEqual(keymap.injectOf('ArrowUp'), { kind: 'key', keyCode: 'Up' });
  assert.deepStrictEqual(keymap.injectOf('KeyW'), { kind: 'key', keyCode: 'W' });
  assert.deepStrictEqual(keymap.injectOf('MouseRight'), { kind: 'mouse', button: 'right' });
  assert.strictEqual(keymap.injectOf('MouseBack'), null);
  assert.strictEqual(keymap.injectOf('Numpad1'), null);
});

// ───────────── 장치 연결 ─────────────
function encodeFrames(frames) {
  const out = [];
  frames.forEach((f) => f.forEach((v, c) => out.push((c === 0 ? 0x80 : 0) | (v >> 7), v & 0x7f)));
  return Buffer.from(out);
}

function fakeHid() {
  const api = {
    devices: [],
    opened: [],
    fail: false,
    HidDecoder: hid.HidDecoder,
    defaultRate: hid.defaultRate,
    listDevices: () => api.devices,
    openDevice(info, cb) {
      if (api.fail) throw new Error('busy');
      const d = { info, cb, restarts: 0, closed: false, restart() { d.restarts++; }, close() { d.closed = true; } };
      api.opened.push(d);
      return d;
    },
  };
  return api;
}

test('장치 연결: 열고, 첫 1초는 필터 안정화로 내보내지 않고, 이후 거른 샘플을 내보낸다 (원시 프레임은 바로)', () => {
  const api = fakeHid();
  let t = 0;
  const hi = new HidInput({ hidApi: api, now: () => t, getSettings: () => ({ signal: { channel: 1, mainsHz: 60, notch: true, highpassHz: 80 } }) });
  api.devices = [{ vendorId: 0x2e73, productId: 1, path: 'p1' }];
  hi.tick(t);
  assert.strictEqual(api.opened.length, 1);
  const emg = [];
  const raw = [];
  hi.on('emg', (v) => emg.push(...v));
  hi.on('frames', (f) => raw.push(...f));
  const chunk = (n) => encodeFrames(Array.from({ length: n }, (_, i) => [512 + Math.round(30 * Math.sin(i)), 512]));
  t = 100;
  api.opened[0].cb.onData(chunk(200));
  assert.ok(raw.length > 150);
  assert.strictEqual(emg.length, 0); // 안정화 중
  t = 1200;
  api.opened[0].cb.onData(chunk(200));
  assert.ok(emg.length > 150);
  assert.ok(Math.abs(emg[emg.length - 1]) < 100);
  assert.strictEqual(hi.status(t).connected, true);
  t = 3000;
  assert.strictEqual(hi.status(t).connected, false); // 1초 넘게 프레임이 없다
});

test('장치 연결: 신호가 멈추면 start 를 다시 보내고, 그래도 없으면 닫았다가 다시 열고, 경로가 바뀌면 새 경로로 연다', () => {
  const api = fakeHid();
  let t = 0;
  const hi = new HidInput({ hidApi: api, now: () => t, getSettings: () => ({ signal: {} }) });
  api.devices = [{ vendorId: 0x2e73, productId: 1, path: 'p1' }];
  hi.tick(t);
  const d = api.opened[0];
  d.cb.onData(encodeFrames(Array.from({ length: 40 }, () => [512, 512])));
  t = 1500; hi.tick(t);
  assert.strictEqual(d.restarts, 0);
  t = 2600; hi.tick(t);
  assert.strictEqual(d.restarts, 1);
  t = 6000; hi.tick(t); // start 후 3초 넘게 없음 → 닫는다
  assert.ok(d.closed);
  t = 8100; hi.tick(t); // 다음 검색 때 다시 연다
  assert.strictEqual(api.opened.length, 2);
  const d2 = api.opened[1];
  api.devices = [{ vendorId: 0x2e73, productId: 1, path: 'p2' }]; // 다른 USB 포트
  d2.cb.onData(encodeFrames(Array.from({ length: 40 }, () => [512, 512])));
  t = 10300; hi.tick(t);
  assert.ok(d2.closed);
  t = 12400; hi.tick(t);
  assert.strictEqual(api.opened.length, 3);
  assert.strictEqual(api.opened[2].info.path, 'p2');
});

test('장치 연결: 열기에 계속 실패하면 재시도 간격을 2→4→8→10초로 늘리고 이유를 보인다', () => {
  const api = fakeHid();
  api.fail = true;
  let t = 0;
  let tries = 0;
  const open = api.openDevice;
  api.openDevice = (info, cb) => { tries++; return open(info, cb); };
  const hi = new HidInput({ hidApi: api, now: () => t, getSettings: () => ({ signal: {} }) });
  api.devices = [{ vendorId: 0x2e73, productId: 1, path: 'p1' }];
  for (t = 0; t <= 20000; t += 500) hi.tick(t);
  assert.ok(tries >= 4 && tries <= 6, 'tries ' + tries);
  assert.strictEqual(hi.status(t).openError, 'busy');
  api.fail = false;
  for (; t <= 40000 && !api.opened.length; t += 500) hi.tick(t);
  assert.strictEqual(api.opened.length, 1);
});

// ───────────── 자동 설정 ─────────────
/** 100 Hz 이상 잡음 신호: 쉴 때 작은 진폭, 힘줄 때 큰 진폭 (구간은 windowMs 단위) */
function synth({ rate = 10000, windowMs = 50, rest = 4000, prep = 2000, squeeze = 4000, restAmp = 2, sqAmp = 40, mains = 0 }) {
  const channels = [[], []];
  const windows = [];
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  let i = 0;
  const per = Math.round((rate * windowMs) / 1000);
  for (const [phase, ms, amp] of [['rest', rest, restAmp], ['prep', prep, restAmp], ['squeeze', squeeze, sqAmp]]) {
    for (let w = 0; w < ms / windowMs; w++) {
      const start = channels[0].length;
      for (let k = 0; k < per; k++, i++) {
        channels[0].push(512 + amp * 2 * rnd() * 3 + mains * Math.sin((2 * Math.PI * 60 * i) / rate));
        channels[1].push(512 + restAmp * 2 * rnd());
      }
      windows.push({ start, end: channels[0].length, phase });
    }
  }
  return { rate, channels, windows };
}

test('자동 설정: 쉴 때·힘줄 때 RMS 통계로 역치를 제안하고, 민감도에 따라 위치가 연속으로 바뀐다', () => {
  const r = analyzeCalibration({ ...synth({}), current: { channel: 1, mainsHz: 60, notch: true, highpassHz: 80 }, mode: 'full' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.emg.channel, 1);
  assert.ok(r.stats.sqTop > r.stats.restHigh * 5, JSON.stringify(r.stats));
  const lo = suggestThreshold(r.stats, 0.2);
  const mid = suggestThreshold(r.stats, 0.35);
  const hi = suggestThreshold(r.stats, 0.6);
  assert.ok(lo.threshold < mid.threshold && mid.threshold < hi.threshold);
  assert.ok(mid.threshold > r.stats.restHigh && mid.threshold < r.stats.sqTop);
  // 해제선은 쉴 때 상한보다 위
  assert.ok(mid.threshold * mid.releaseRatio > r.stats.restHigh);
  assert.ok(mid.releaseRatio >= 0.4 && mid.releaseRatio <= 0.95);
});

test('자동 설정: 힘줄 때가 쉴 때와 비슷하면 제안하지 않는다, 신호가 거의 없으면 오류', () => {
  assert.strictEqual(suggestThreshold({ restHigh: 5, sqTop: 6, restMid: 4, sqMax: 7 }), null);
  assert.strictEqual(suggestThreshold(null), null);
  assert.strictEqual(suggestThreshold({ restHigh: 5, sqTop: null }), null);
  const bad = analyzeCalibration({ rate: 10000, channels: [[512, 512]], windows: [{ start: 0, end: 2, phase: 'rest' }], current: {}, mode: 'full' });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.error);
});

test('자동 설정 진행기: 쉼 4초 → 준비 2초 → 힘주기 4초 후 끝나고 결과를 낸다', () => {
  assert.deepStrictEqual(STEPS.full.map((s) => s[1]), [4000, 2000, 4000]);
  const cal = new AutoCal();
  const s = synth({});
  cal.start('full', 0);
  assert.strictEqual(cal.status(0).phase, 'rest');
  let done = false;
  let t = 0;
  const per = 500;
  for (let w = 0; w < s.windows.length && !done; w++) {
    t += 50;
    cal.addFrames(s.channels[0].slice(s.windows[w].start, s.windows[w].end).map((v, k) => [v, s.channels[1][s.windows[w].start + k]]), 10000);
    done = cal.tick(t, { channel: 1 });
    if (t === 4000) assert.strictEqual(cal.status(t).phase, 'prep');
  }
  assert.ok(done);
  assert.ok(cal.result.ok, JSON.stringify(cal.result));
  assert.ok(cal.result.stats.sqTop > cal.result.stats.restHigh * 3);
});

// ───────────── 신호 처리 ─────────────
test('구간 RMS: 상수는 0, 사인파는 진폭/√2, 필터는 직류와 60 Hz 를 없앤다', () => {
  const w = new EmgWindow();
  w.add(new Array(500).fill(512));
  assert.strictEqual(w.take().rms, 0);
  assert.strictEqual(w.take(), null);
  const f = new EmgFilter(10000, { mainsHz: 60, notch: true, highpassHz: 80 });
  const x = Array.from({ length: 20000 }, (_, i) => 512 + 40 * Math.sin((2 * Math.PI * 60 * i) / 10000));
  const y = f.process(x).slice(10000);
  const win = new EmgWindow();
  win.add(y);
  assert.ok(win.take().rms < 0.5, '60 Hz 가 남았다');
  const g = new EmgFilter(10000, { mainsHz: 60, notch: true, highpassHz: 80 });
  const z = g.process(Array.from({ length: 20000 }, (_, i) => 512 + 40 * Math.sin((2 * Math.PI * 1000 * i) / 10000))).slice(10000);
  const win2 = new EmgWindow();
  win2.add(z);
  assert.ok(Math.abs(win2.take().rms - 40 / Math.SQRT2) < 4, '1000 Hz 신호가 깎였다');
});

console.log(`\n${passed}개 통과`);
