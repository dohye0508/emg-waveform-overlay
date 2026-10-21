'use strict';

// 메인 프로세스: 장치 입력 → 구간 RMS → 키 엔진 → SendInput, 오버레이 창, 설정 창, 트레이, 전역 단축키.
// 상태와 타이밍은 전부 여기에 있고, 화면(렌더러)은 payload 를 그리기만 한다.

const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage, shell } = require('electron');
const { HidInput } = require('./hidinput');
const { EmgWindow } = require('./emg');
const { KeyEngine } = require('./engine');
const keysender = require('./keysender');
const keymap = require('./keymap');
const layout = require('./layout');
const { Store, normalizeSettings, merge } = require('./store');
const { AutoCal, suggestThreshold } = require('./calib');
const games = require('./games');
const winfocus = require('./winfocus');

const FRAME_MS = 33;
const SIGNAL_LOST_MS = 500;
const COLUMNS = 240;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
// 게임 소리가 첫 입력 전에도 나오게
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let store, settings;
let hidIn, engine, emgWin, ring, cal;
let settingsWin = null, overlayWin = null, tray = null;
let quitting = false;
let running = false;
let test = false;
let overlayVisible = true;
let dragMode = false;
let rms = 0;
let rate = 10000;
let lastEmgAt = 0;
let calSens = 0.35;
let hotkeyOk = { toggle: true, overlay: true };
let rmsTimer = null;
let gameWin = null;
let activeGame = null; // 사용자 모드에서 하고 있는 게임
let nativeState = {}; // Windows 게임(얼불춤 등)의 상태: { [id]: 'off' | 'launching' | 'on' }
let nativeWait = null; // 실행을 기다리는 타이머
let uiMode = process.argv.includes('--admin') ? 'admin' : 'user';

const now = () => Date.now();

/** 지금 키 엔진에 줄 설정: 게임 중이면 게임 키 하나, 아니면 관리자 설정 */
function keyConfig() {
  if (activeGame) return games.engineConfigFor(activeGame, settings);
  return {
    threshold: settings.trigger.threshold,
    threshold2: settings.trigger.threshold2,
    releaseRatio: settings.trigger.releaseRatio,
    levels: settings.key.levels,
    mode: settings.key.mode,
    tapMs: settings.key.tapMs,
    cooldownMs: settings.key.cooldownMs,
    decideMs: settings.key.decideMs,
    code: settings.key.code,
    code2: settings.key.code2,
  };
}

function applyEngine() {
  engine.configure(keyConfig());
  engine.setTest(test);
  engine.setEnabled((running || test) && !cal.running, now());
}

function restartRmsTimer() {
  clearInterval(rmsTimer);
  rmsTimer = setInterval(() => {
    const w = emgWin.take();
    if (!w) return;
    rms = w.rms;
    engine.update(rms, now());
  }, settings.trigger.windowMs);
}

function targetDisplay() {
  const all = screen.getAllDisplays();
  const i = settings.overlay.display;
  return Number.isInteger(i) && all[i] ? all[i] : screen.getPrimaryDisplay();
}

function placeOverlay() {
  if (!overlayWin || overlayWin.isDestroyed() || dragMode) return;
  const o = settings.overlay;
  overlayWin.setBounds(layout.overlayBounds(targetDisplay().workArea, o.x, o.y, o.scale));
  overlayWin.setOpacity(o.opacity / 100);
}

function createOverlay() {
  overlayWin = new BrowserWindow({
    width: layout.BASE_W, height: layout.BASE_H, show: false,
    frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  overlayWin.on('closed', () => { overlayWin = null; });
}

function updateOverlayVisibility() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const want = (running || test || dragMode) && overlayVisible;
  if (want && !overlayWin.isVisible()) { placeOverlay(); overlayWin.showInactive(); }
  else if (!want && overlayWin.isVisible()) overlayWin.hide();
}

function createSettings() {
  settingsWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500, show: false, backgroundColor: '#070B14',
    title: 'EMG Overlay', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(pagePath());
  settingsWin.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) settingsWin.show(); });
  settingsWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); settingsWin.hide(); }
  });
}

function pagePath() {
  return path.join(__dirname, '..', 'renderer', uiMode === 'admin' ? 'index.html' : 'home.html');
}

/** 사용자 화면 ↔ 관리자 화면 (같은 창에서 페이지만 바꾼다) */
function setMode(m) {
  uiMode = m === 'admin' ? 'admin' : 'user';
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.loadFile(pagePath());
}

/**
 * 힘 → 키를 보낸다. 게임 창이 열려 있으면 그 창에 직접 넣는다 (포커스·관리자 권한과 상관없다).
 * 게임 창에 넣을 수 없는 키(숫자패드, 뒤로·앞으로 버튼)나 게임이 없을 때는 Windows 전체로 보낸다.
 */
function sendKey(action, code) {
  const inj = keymap.injectOf(code);
  if (gameWin && !gameWin.isDestroyed() && inj) {
    const wc = gameWin.webContents;
    if (inj.kind === 'key') {
      wc.sendInputEvent({ type: action === 'down' ? 'keyDown' : 'keyUp', keyCode: inj.keyCode });
    } else {
      const [w, h] = gameWin.getContentSize();
      wc.sendInputEvent({ type: action === 'down' ? 'mouseDown' : 'mouseUp', x: Math.round(w / 2), y: Math.round(h / 2), button: inj.button, clickCount: 1 });
    }
    return;
  }
  if (action === 'down') keysender.press(code);
  else keysender.release(code);
}

/**
 * 게임 페이지 높이(fitHeight)가 창 높이에 꽉 차게 하는 확대 배율.
 * 픽셀 그림이 고르게 보이도록 실제 화면 픽셀 기준으로 정수 배(2배, 3배…)를 고르고, 2배도 안 되면 그냥 꽉 채운다.
 */
function zoomFor(win, fitHeight) {
  const sf = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
  const physical = win.getContentSize()[1] * sf;
  const exact = physical / fitHeight;
  const k = exact >= 2 ? Math.floor(exact) : exact;
  return Math.max(0.5, k / sf);
}

/** 사용자 화면을 다시 맨 앞으로 (다른 프로그램 위로) */
function bringHome() {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  settingsWin.show();
  settingsWin.setAlwaysOnTop(true);
  settingsWin.focus();
  setTimeout(() => { if (!settingsWin.isDestroyed()) settingsWin.setAlwaysOnTop(false); }, 300);
}

/**
 * Windows 게임 창이 뜰 때까지 기다렸다가 onReady(창) 를 부른다. 꺼져 있으면 Steam 으로 켠다.
 * 90초 안에 안 뜨면 포기한다.
 */
function waitNative(game, onReady) {
  clearInterval(nativeWait);
  const now0 = Date.now();
  let h = winfocus.find(game.windowTitle);
  if (h) { nativeState[game.id] = 'on'; onReady(h); return; }
  nativeState[game.id] = 'launching';
  shell.openExternal(game.launchUrl);
  nativeWait = setInterval(() => {
    h = winfocus.find(game.windowTitle);
    if (h) {
      clearInterval(nativeWait);
      nativeWait = null;
      nativeState[game.id] = 'on';
      // 창이 막 떴을 때는 아직 그리는 중이라 조금 기다렸다 쓴다
      setTimeout(() => onReady(winfocus.find(game.windowTitle) || h), 1500);
    } else if (Date.now() - now0 > 90000) {
      clearInterval(nativeWait);
      nativeWait = null;
      nativeState[game.id] = 'off';
      if (activeGame === game) stopGame();
    }
  }, 500);
}

/** 얼불춤처럼 앱 밖의 Windows 게임: 창을 앞으로 가져오고 SendInput 으로 키를 보낸다 */
function playNative(game) {
  activeGame = game;
  try { globalShortcut.register(game.exitAccel, stopGame); } catch (_) { /* ignore */ }
  console.log('[game] 시작', game.id);
  engine.releaseAll();
  waitNative(game, (h) => {
    if (activeGame !== game) return;
    winfocus.focus(h);
    setRunning(true);
  });
}

/** 미리 켜 두기: 게임을 켜고, 창이 뜨면 사용자 화면을 다시 앞으로 */
function prelaunchGame(id) {
  const game = games.gameById(id);
  if (!game || !game.native || activeGame) return;
  waitNative(game, () => { if (!activeGame) bringHome(); });
}

function playGame(id) {
  const game = games.gameById(id);
  if (!game) return;
  if (game.native) { playNative(game); return; }
  const old = gameWin;
  gameWin = null;
  if (old && !old.isDestroyed()) old.close();
  activeGame = game;
  const disp = settingsWin ? screen.getDisplayMatching(settingsWin.getBounds()) : screen.getPrimaryDisplay();
  console.log('[game] 시작', id);
  const win = new BrowserWindow({
    ...disp.bounds, show: false, fullscreen: true, autoHideMenuBar: true, backgroundColor: '#000000', title: game.name,
    // 게임 페이지(외부 사이트 포함)에는 앱 기능을 주지 않는다
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  gameWin = win;
  win.setMenu(null);
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 게임 페이지 밖(사이트의 다른 페이지 등)으로는 넘어가지 않는다
  const allowed = game.url ? game.url.replace(/[^/]*$/, '') : 'file:';
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(allowed)) e.preventDefault(); });
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); stopGame(); }
  });
  // 작은 화면용으로 만든 게임(floppybird 는 날 수 있는 칸이 420px)은 화면 높이에 맞춰 확대한다
  wc.on('did-finish-load', () => {
    if (win.isDestroyed()) return;
    if (game.fitHeight) wc.setZoomFactor(zoomFor(win, game.fitHeight));
    if (game.css) wc.insertCSS(game.css);
  });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  // 게임 창에 포커스가 없어도 Esc 로 나갈 수 있게 게임 중에만 전역으로 잡는다
  try { if (!globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', stopGame); } catch (_) { /* ignore */ }
  win.on('closed', () => {
    // 다른 게임으로 바꾸며 닫은 옛 창이면 새 게임 상태를 건드리지 않는다
    if (gameWin !== win) return;
    console.log('[game] 끝', id);
    try { globalShortcut.unregister('Escape'); } catch (_) { /* ignore */ }
    gameWin = null;
    activeGame = null;
    setRunning(false);
    showSettings();
  });
  if (game.url) win.loadURL(game.url);
  // floppybird 는 주소 끝이 정확히 '?easy' 여야 쉬운 모드라서 loadFile 의 query(→ '?easy=') 대신 주소를 직접 만든다
  else win.loadURL(pathToFileURL(path.join(__dirname, '..', 'renderer', game.file)).href + (game.search || ''));
  engine.releaseAll();
  setRunning(true);
}

function stopGame() {
  if (activeGame && activeGame.native) {
    // Windows 게임은 끄지 않고 뒤에 둔다 (다음 사람이 바로 시작)
    const game = activeGame;
    try { globalShortcut.unregister(game.exitAccel); } catch (_) { /* ignore */ }
    clearInterval(nativeWait);
    nativeWait = null;
    if (nativeState[game.id] === 'launching') nativeState[game.id] = 'off';
    console.log('[game] 끝', game.id);
    activeGame = null;
    setRunning(false);
    bringHome();
    return;
  }
  if (gameWin && !gameWin.isDestroyed()) gameWin.close();
}

function showSettings() {
  if (!settingsWin) return;
  if (settingsWin.isMinimized()) settingsWin.restore();
  settingsWin.show();
  settingsWin.focus();
}

function setRunning(on) {
  running = !!on;
  if (!running) engine.releaseAll();
  applyEngine();
  updateOverlayVisibility();
  refreshTray();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const reg = (accel, fn) => {
    try { return globalShortcut.register(accel, fn); } catch (_) { return false; }
  };
  hotkeyOk.toggle = reg(settings.hotkeys.toggle, () => setRunning(!running));
  hotkeyOk.overlay = reg(settings.hotkeys.overlay, () => { overlayVisible = !overlayVisible; updateOverlayVisibility(); });
}

function trayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = Math.floor(i / size);
    const d = Math.hypot(x - 7.5, y - 7.5);
    const on = d < 7;
    buf[i * 4] = 0xf2; buf[i * 4 + 1] = 0xe0; buf[i * 4 + 2] = 0x35; buf[i * 4 + 3] = on ? 255 : 0; // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: running ? '가동 정지' : '가동 시작', click: () => setRunning(!running) },
    { label: '사용자 화면', click: () => { setMode('user'); showSettings(); } },
    { label: '관리자 화면', click: () => { setMode('admin'); showSettings(); } },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
  tray.setToolTip('EMG Overlay · ' + (running ? '가동 중' : '정지'));
}

// 슬라이더를 끌 때마다 디스크에 쓰지 않도록 모아서 저장한다
let saveTimer = null;
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try { store.save(settings); } catch (err) { console.error('[store] 저장 실패:', err.message); }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
}

function patchSettings(patch) {
  const before = settings;
  settings = normalizeSettings(merge(settings, patch));
  scheduleSave();
  if (patch.hotkeys) registerHotkeys();
  if (patch.trigger && settings.trigger.windowMs !== before.trigger.windowMs) restartRmsTimer();
  if (patch.signal && before.signal.seconds !== settings.signal.seconds) { /* 다음 프레임에 반영 */ }
  applyEngine();
  placeOverlay();
}

// --demo: 장치 없이 화면을 확인하려고 쉬기·힘주기를 번갈아 흉내 낸 신호를 넣는다 (키 판정 경로는 같다)
const DEMO = process.argv.includes('--demo');
function startDemo(onValues) {
  const t0 = now();
  setInterval(() => {
    const t = now();
    // 6초 주기: 쉼 → 약하게(≈14) → 쉼 → 세게(≈30)
    const phase = ((t - t0) % 6000) / 6000;
    const amp = phase > 0.2 && phase < 0.4 ? 14 + 2 * Math.sin(phase * 50) : phase > 0.6 && phase < 0.8 ? 30 + 6 * Math.sin(phase * 40) : 2.2;
    const n = 200; // 20 ms × 10 kHz
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = (Math.random() + Math.random() + Math.random() - 1.5) * amp * 2;
    onValues(out, 10000);
  }, 20);
}

function deviceStatus(t) {
  return DEMO ? { connected: true, fps: 10000, channels: 2, name: '데모 신호', openError: null } : hidIn.status(t);
}

function liveState() {
  const t = now();
  const st = deviceStatus(t);
  return {
    rms, connected: st.connected, fps: st.fps, channels: st.channels, name: st.name, openError: st.openError,
    active: engine.active, level: engine.level, pressed: engine.pressed, pressedLevel: engine.pressedLevel,
  };
}

function payload() {
  const t = now();
  const st = cal.status(t);
  const sug = st.result && st.result.ok ? suggestThreshold(st.result.stats, calSens) : null;
  return {
    version: app.getVersion(),
    settings,
    running, test, overlayVisible, dragMode,
    live: liveState(),
    wave: { env: Array.from(ring.envelope(Math.max(1, Math.round(settings.signal.seconds * rate)), 480)), range: settings.signal.scale },
    cal: st, calSens, suggestion: sug,
    hotkeyOk,
    keys: { available: keysender.available, error: keysender.error, label: keymap.label(settings.key.code), label2: keymap.label(settings.key.code2) },
    presets: settings.presets.map((p, i) => ({ index: i, used: !!p.data, label: presetLabel(p.data) })),
    activePreset: settings.activePreset,
    uiMode,
    activeGame: activeGame ? activeGame.id : null,
    games: games.GAMES.map((g) => ({
      id: g.id, name: g.name, online: g.online, native: !!g.native, exitAccel: g.exitAccel || 'Esc',
      state: g.native ? nativeState[g.id] || 'off' : null,
      key: settings.user.keys[g.id], label: keymap.label(settings.user.keys[g.id]),
      levels: g.levels === 2 ? 2 : 1,
      key2: settings.user.keys2[g.id] || null, label2: settings.user.keys2[g.id] ? keymap.label(settings.user.keys2[g.id]) : null,
    })),
    displays: screen.getAllDisplays().map((d, i) => ({ index: i, label: (d.label || '모니터') + ' ' + d.size.width + '×' + d.size.height, primary: d.id === screen.getPrimaryDisplay().id })),
  };
}

/** 프리셋 버튼에 보일 키 이름 */
function presetLabel(data) {
  if (!data) return '';
  const k = data.key;
  return k.levels === 2 ? keymap.label(k.code) + ' · ' + keymap.label(k.code2) : keymap.label(k.code);
}

function selectPreset(i) {
  const p = settings.presets[i];
  if (!p) return;
  // 고른 칸에 저장된 설정을 지금 설정으로 (빈 칸이면 지금 설정을 그 칸에 담는다)
  settings = normalizeSettings({ ...merge(settings, p.data || {}), activePreset: i });
  scheduleSave();
  restartRmsTimer();
  applyEngine();
  placeOverlay();
}

function overlayFrame() {
  const sg = settings.signal;
  const kc = keyConfig();
  const n = Math.max(1, Math.round(sg.seconds * rate));
  return {
    env: Array.from(ring.envelope(n, COLUMNS)),
    rms, threshold: settings.trigger.threshold, release: settings.trigger.threshold * settings.trigger.releaseRatio,
    threshold2: settings.trigger.threshold2, levels: kc.levels, level: engine.level,
    range: sg.scale, active: engine.active, pressed: engine.pressed, pressedLevel: engine.pressedLevel,
    keyLabel: keymap.label(kc.code), keyLabel2: keymap.label(kc.code2),
    connected: deviceStatus(now()).connected, test, drag: dragMode,
  };
}

function pushFrames() {
  if (settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible()) settingsWin.webContents.send('state', payload());
  if (overlayWin && !overlayWin.isDestroyed() && (overlayWin.isVisible())) overlayWin.webContents.send('frame', overlayFrame());
}

function startDrag() {
  if (dragMode || !overlayWin) return;
  dragMode = true;
  overlayWin.setIgnoreMouseEvents(false);
  overlayWin.setFocusable(true);
  overlayWin.setMovable(true);
  overlayWin.setResizable(true);
  overlayWin.setAspectRatio(layout.BASE_W / layout.BASE_H);
  overlayWin.setMinimumSize(Math.round(layout.BASE_W * 0.5), Math.round(layout.BASE_H * 0.5));
  overlayWin.setMaximumSize(layout.BASE_W * 2, layout.BASE_H * 2);
  overlayVisible = true;
  updateOverlayVisibility();
  overlayWin.webContents.send('drag', true);
}

function finishDrag() {
  if (!dragMode || !overlayWin) return;
  const b = overlayWin.getBounds();
  const disp = screen.getDisplayMatching(b);
  const idx = screen.getAllDisplays().findIndex((d) => d.id === disp.id);
  dragMode = false;
  overlayWin.setMovable(false);
  overlayWin.setResizable(false);
  overlayWin.setAspectRatio(0);
  overlayWin.setMinimumSize(1, 1);
  overlayWin.setMaximumSize(0, 0);
  overlayWin.setFocusable(false);
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.webContents.send('drag', false);
  const pos = layout.settingsFromBounds(disp.workArea, b);
  patchSettings({ overlay: { ...pos, display: idx >= 0 ? idx : 'primary' } });
  updateOverlayVisibility();
}

function keyTest() {
  // 3초 뒤 약하게 키, 2단계면 1초 뒤 세게 키
  const codes = settings.key.levels === 2 ? [settings.key.code, settings.key.code2] : [settings.key.code];
  codes.forEach((code, i) => {
    setTimeout(() => {
      keysender.press(code);
      setTimeout(() => keysender.release(code), 300);
    }, 3000 + i * 1000);
  });
}

function wireIpc() {
  ipcMain.handle('state:get', () => payload());
  ipcMain.handle('accel:fromEvent', (_e, ev) => keymap.acceleratorFromEvent(ev));
  ipcMain.handle('settings:patch', (_e, patch) => { patchSettings(patch || {}); return payload(); });
  ipcMain.handle('run:set', (_e, on) => { setRunning(on); return payload(); });
  ipcMain.handle('overlay:toggle', () => { overlayVisible = !overlayVisible; updateOverlayVisibility(); return payload(); });
  ipcMain.handle('test:set', (_e, on) => { test = !!on; applyEngine(); updateOverlayVisibility(); return payload(); });
  ipcMain.handle('drag:set', (_e, on) => { if (on) startDrag(); else finishDrag(); return payload(); });
  ipcMain.handle('key:test', () => { keyTest(); return true; });
  ipcMain.handle('ui:mode', (_e, m) => { setMode(m); return true; });
  ipcMain.handle('game:play', (_e, id) => { playGame(String(id)); return true; });
  ipcMain.handle('game:stop', () => { stopGame(); return true; });
  ipcMain.handle('game:prelaunch', (_e, id) => { prelaunchGame(String(id)); return true; });
  ipcMain.handle('preset:select', (_e, i) => { selectPreset(Number(i)); return payload(); });
  ipcMain.handle('device:reconnect', () => { hidIn.reconnect(); return true; });
  ipcMain.handle('cal:start', () => {
    if (!deviceStatus(now()).connected) return payload();
    cal.start('full', now());
    applyEngine();
    return payload();
  });
  ipcMain.handle('cal:cancel', () => { cal.cancel(); applyEngine(); return payload(); });
  ipcMain.handle('cal:sens', (_e, v) => { calSens = Math.min(0.9, Math.max(0.05, Number(v) || 0.35)); return payload(); });
  ipcMain.handle('cal:apply', () => {
    const r = cal.result;
    if (!r || !r.ok) return payload();
    const sug = suggestThreshold(r.stats, calSens);
    const patch = { signal: { channel: r.emg.channel, mainsHz: r.emg.mainsHz, notch: r.emg.notch, highpassHz: r.emg.highpassHz } };
    if (sug) patch.trigger = { threshold: sug.threshold, threshold2: sug.threshold2, releaseRatio: sug.releaseRatio };
    patchSettings(patch);
    cal.cancel();
    applyEngine();
    return payload();
  });
}

function shutdown() {
  quitting = true;
  if (saveTimer) saveNow();
  try { engine.releaseAll(); } catch (_) { /* ignore */ }
  try { globalShortcut.unregisterAll(); } catch (_) { /* ignore */ }
  try { hidIn.stop(); } catch (_) { /* ignore */ }
}

app.on('second-instance', showSettings);
app.on('before-quit', shutdown);
app.on('window-all-closed', () => { /* 트레이에 남는다 */ });
process.on('uncaughtException', (err) => {
  console.error('[fatal]', err);
  try { engine.releaseAll(); } catch (_) { /* ignore */ }
});

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));
  settings = store.load();
  ring = new layout.SampleRing(60000);
  emgWin = new EmgWindow();
  cal = new AutoCal();
  engine = new KeyEngine({
    send: sendKey,
  });
  hidIn = new HidInput({ getSettings: () => settings });
  const onEmg = (values, r) => {
    rate = r;
    lastEmgAt = now();
    ring.push(values);
    emgWin.add(values);
  };
  hidIn.on('emg', onEmg);
  hidIn.on('frames', (frames, r) => { if (cal.running) cal.addFrames(frames, r); });
  hidIn.on('closed', () => { engine.signalLost(); rms = 0; });

  tray = new Tray(trayIcon());
  tray.on('click', showSettings);
  refreshTray();

  wireIpc();
  createOverlay();
  createSettings();
  registerHotkeys();
  applyEngine();
  restartRmsTimer();
  if (DEMO) startDemo(onEmg);
  else hidIn.start();

  setInterval(() => {
    const t = now();
    engine.tick(t);
    if (lastEmgAt && t - lastEmgAt > SIGNAL_LOST_MS) {
      rms = 0;
      engine.signalLost();
    }
  }, 10);
  setInterval(() => {
    if (cal.running && cal.tick(now(), settings.signal)) applyEngine();
  }, 100);
  setInterval(pushFrames, FRAME_MS);
  // Windows 게임이 켜져 있는지 1초마다 본다. 하는 중에 게임이 꺼지면 사용자 화면으로 돌아온다
  setInterval(() => {
    for (const g of games.GAMES) {
      if (!g.native || nativeState[g.id] === 'launching') continue;
      const on = winfocus.exists(g.windowTitle);
      nativeState[g.id] = on ? 'on' : 'off';
      if (!on && activeGame === g) stopGame();
    }
  }, 1000);

  screen.on('display-metrics-changed', placeOverlay);
  screen.on('display-added', placeOverlay);
  screen.on('display-removed', placeOverlay);
});
