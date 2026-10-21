'use strict';

// 키 이름(e.code) ↔ Windows 스캔코드(세트 1), 표시 이름, Electron 전역 단축키 문자열.
// 게임은 가상 키가 아니라 스캔코드를 읽는 경우가 많아서 SendInput 을 스캔코드 방식으로 보낸다.

const SC = {};
const EXT = new Set();

function add(code, sc, ext = false) {
  SC[code] = sc;
  if (ext) EXT.add(code);
}

'QWERTYUIOP'.split('').forEach((c, i) => add('Key' + c, 0x10 + i));
'ASDFGHJKL'.split('').forEach((c, i) => add('Key' + c, 0x1e + i));
'ZXCVBNM'.split('').forEach((c, i) => add('Key' + c, 0x2c + i));
'1234567890'.split('').forEach((c, i) => add('Digit' + c, 0x02 + i));
[['Minus', 0x0c], ['Equal', 0x0d], ['Backspace', 0x0e], ['Tab', 0x0f], ['BracketLeft', 0x1a], ['BracketRight', 0x1b],
  ['Enter', 0x1c], ['ControlLeft', 0x1d], ['Semicolon', 0x27], ['Quote', 0x28], ['Backquote', 0x29], ['ShiftLeft', 0x2a],
  ['Backslash', 0x2b], ['Comma', 0x33], ['Period', 0x34], ['Slash', 0x35], ['ShiftRight', 0x36], ['NumpadMultiply', 0x37],
  ['AltLeft', 0x38], ['Space', 0x39], ['CapsLock', 0x3a], ['NumLock', 0x45], ['ScrollLock', 0x46], ['Escape', 0x01],
  ['Numpad7', 0x47], ['Numpad8', 0x48], ['Numpad9', 0x49], ['NumpadSubtract', 0x4a], ['Numpad4', 0x4b], ['Numpad5', 0x4c],
  ['Numpad6', 0x4d], ['NumpadAdd', 0x4e], ['Numpad1', 0x4f], ['Numpad2', 0x50], ['Numpad3', 0x51], ['Numpad0', 0x52],
  ['NumpadDecimal', 0x53], ['F11', 0x57], ['F12', 0x58]].forEach(([c, s]) => add(c, s));
for (let i = 1; i <= 10; i++) add('F' + i, 0x3a + i);
[['ControlRight', 0x1d], ['AltRight', 0x38], ['NumpadEnter', 0x1c], ['NumpadDivide', 0x35], ['Home', 0x47], ['ArrowUp', 0x48],
  ['PageUp', 0x49], ['ArrowLeft', 0x4b], ['ArrowRight', 0x4d], ['End', 0x4f], ['ArrowDown', 0x50], ['PageDown', 0x51],
  ['Insert', 0x52], ['Delete', 0x53], ['MetaLeft', 0x5b], ['MetaRight', 0x5c], ['ContextMenu', 0x5d]].forEach(([c, s]) => add(c, s, true));

// 마우스 버튼: SendInput 의 MOUSEEVENTF 값 (down, up) 과 XBUTTON 번호
const MOUSE = {
  MouseLeft: { down: 0x0002, up: 0x0004, data: 0 },
  MouseRight: { down: 0x0008, up: 0x0010, data: 0 },
  MouseMiddle: { down: 0x0020, up: 0x0040, data: 0 },
  MouseBack: { down: 0x0080, up: 0x0100, data: 1 },
  MouseForward: { down: 0x0080, up: 0x0100, data: 2 },
};
/** 마우스 이벤트의 button 번호(0 왼쪽, 1 가운데, 2 오른쪽, 3 뒤로, 4 앞으로) → 코드 */
const MOUSE_BY_BUTTON = ['MouseLeft', 'MouseMiddle', 'MouseRight', 'MouseBack', 'MouseForward'];

/** e.code → { sc, ext } 또는 { mouse } (지원하지 않는 키는 null) */
function lookup(code) {
  if (Object.prototype.hasOwnProperty.call(MOUSE, code)) return { mouse: MOUSE[code] };
  return Object.prototype.hasOwnProperty.call(SC, code) ? { sc: SC[code], ext: EXT.has(code) } : null;
}

const LABELS = {
  MouseLeft: '좌클릭', MouseRight: '우클릭', MouseMiddle: '휠클릭', MouseBack: '뒤로', MouseForward: '앞으로',
  Space: 'SPACE', Enter: 'ENTER', Escape: 'ESC', Tab: 'TAB', Backspace: 'BACKSPACE', CapsLock: 'CAPS',
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT', AltRight: 'R-ALT',
  MetaLeft: 'L-WIN', MetaRight: 'R-WIN', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  PageUp: 'PGUP', PageDown: 'PGDN', Insert: 'INS', Delete: 'DEL', Home: 'HOME', End: 'END',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', NumpadEnter: 'NUM ENTER', NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -',
  NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM .',
};

/** 칩에 보여 줄 이름 */
function label(code) {
  if (LABELS[code]) return LABELS[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code);
  if (m) return 'NUM ' + m[1];
  return String(code || '').toUpperCase();
}

// ── 전역 단축키 (Electron accelerator) ──
const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight']);

const ACCEL_KEYS = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Escape: 'Esc',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\',
};

function accelKey(code) {
  if (ACCEL_KEYS[code]) return ACCEL_KEYS[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  m = /^F(\d{1,2})$/.exec(code);
  if (m && +m[1] >= 1 && +m[1] <= 24) return 'F' + m[1];
  return null;
}

/**
 * 키 이벤트 → 'Ctrl+Alt+F9' 같은 문자열. 모디파이어만 눌렸거나 지원하지 않는 키면 null.
 * 모디파이어 없이는 F1~F24 만 허용한다 (글자 키 하나를 전역으로 잡으면 타이핑이 막힌다).
 */
function acceleratorFromEvent(e) {
  if (!e || MODIFIER_CODES.has(e.code)) return null;
  const key = accelKey(e.code);
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return null;
  return mods.concat(key).join('+');
}

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'];

/** 저장된 문자열을 표준 모양('Ctrl+Alt+F9')으로. 올바르지 않으면 null */
function normalizeAccelerator(s) {
  if (typeof s !== 'string') return null;
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 5) return null;
  let key = parts[parts.length - 1];
  if (/^(f\d{1,2}|[a-z])$/i.test(key)) key = key.toUpperCase();
  const mods = new Set();
  for (const p of parts.slice(0, -1)) {
    const m = { control: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Super', win: 'Super', meta: 'Super' }[p.toLowerCase()];
    if (!m) return null;
    mods.add(m);
  }
  const keyOk = /^(F([1-9]|1\d|2[0-4]))$/.test(key) || /^[A-Z0-9]$/.test(key) || Object.values(ACCEL_KEYS).includes(key);
  if (!keyOk) return null;
  if (!mods.size && !/^F\d{1,2}$/.test(key)) return null;
  return MOD_ORDER.filter((m) => mods.has(m)).concat(key).join('+');
}

/** 칩에 보여 줄 모양: 'Ctrl + Alt + F9' */
function acceleratorLabel(s) {
  return String(s || '').split('+').join(' + ');
}

module.exports = { MOUSE_BY_BUTTON, lookup, label, acceleratorFromEvent, normalizeAccelerator, acceleratorLabel, MODIFIER_CODES };
