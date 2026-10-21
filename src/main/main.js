'use strict';

// 메인 프로세스: 장치 입력 → 구간 RMS → 키 엔진 → SendInput, 오버레이 창, 설정 창, 트레이, 전역 단축키.
// 상태와 타이밍은 전부 여기에 있고, 화면(렌더러)은 payload 를 그리기만 한다.

const path = require('path');
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, nativeImage } = require('electron');
const { HidInput } = require('./hidinput');
const { EmgWindow } = require('./emg');
const { KeyEngine } = require('./engine');
const keysender = require('./keysender');
const keymap = require('./keymap');
const layout = require('./layout');
const { Store, normalizeSettings, merge } = require('./store');
const { AutoCal, suggestThreshold } = require('./calib');

const FRAME_MS = 33;
const SIGNAL_LOST_MS = 500;
const COLUMNS = 240;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

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

const now = () => Date.now();

function applyEngine() {
  engine.configure({
    threshold: settings.trigger.threshold,
    releaseRatio: settings.trigger.releaseRatio,
    mode: settings.key.mode,
    tapMs: settings.key.tapMs,
    cooldownMs: settings.key.cooldownMs,
    code: settings.key.code,
  });
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
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  settingsWin.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) settingsWin.show(); });
  settingsWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); settingsWin.hide(); }
  });
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
    { label: '설정 열기', click: showSettings },
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

function liveState() {
  const t = now();
  const st = hidIn.status(t);
  return {
    rms, connected: st.connected, fps: st.fps, channels: st.channels, name: st.name, openError: st.openError,
    active: engine.active, pressed: engine.pressed,
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
    cal: st, calSens, suggestion: sug,
    hotkeyOk,
    keys: { available: keysender.available, error: keysender.error, label: keymap.label(settings.key.code) },
    displays: screen.getAllDisplays().map((d, i) => ({ index: i, label: (d.label || '모니터') + ' ' + d.size.width + '×' + d.size.height, primary: d.id === screen.getPrimaryDisplay().id })),
  };
}

function overlayFrame() {
  const sg = settings.signal;
  const n = Math.max(1, Math.round(sg.seconds * rate));
  return {
    env: Array.from(ring.envelope(n, COLUMNS)),
    rms, threshold: settings.trigger.threshold, release: settings.trigger.threshold * settings.trigger.releaseRatio,
    range: sg.scale, active: engine.active, pressed: engine.pressed, keyLabel: keymap.label(settings.key.code),
    connected: hidIn.status(now()).connected, test, drag: dragMode,
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
  const code = settings.key.code;
  setTimeout(() => {
    keysender.press(code);
    setTimeout(() => keysender.release(code), 300);
  }, 3000);
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
  ipcMain.handle('device:reconnect', () => { hidIn.reconnect(); return true; });
  ipcMain.handle('cal:start', () => {
    if (!hidIn.status(now()).connected) return payload();
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
    if (sug) patch.trigger = { threshold: sug.threshold, releaseRatio: sug.releaseRatio };
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
    send: (action, code) => { if (action === 'down') keysender.press(code); else keysender.release(code); },
  });
  hidIn = new HidInput({ getSettings: () => settings });
  hidIn.on('emg', (values, r) => {
    rate = r;
    lastEmgAt = now();
    ring.push(values);
    emgWin.add(values);
  });
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
  hidIn.start();

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

  screen.on('display-metrics-changed', placeOverlay);
  screen.on('display-added', placeOverlay);
  screen.on('display-removed', placeOverlay);
});
