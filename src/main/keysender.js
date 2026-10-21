'use strict';

// Windows SendInput 으로 키를 누르고 뗀다 (스캔코드 방식: 게임이 읽는 방식과 같다).
// koffi 가 없거나 Windows 가 아니면 available = false 이고 아무것도 보내지 않는다.

const { lookup } = require('./keymap');

const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const INPUT_KEYBOARD = 1;

let impl = null;
let loadError = null;

function load() {
  if (impl || loadError) return;
  if (process.platform !== 'win32') {
    loadError = new Error('Windows 에서만 키를 보낼 수 있습니다');
    return;
  }
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const MOUSEINPUT = koffi.struct('MOUSEINPUT', {
      dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr',
    });
    const KEYBDINPUT = koffi.struct('KEYBDINPUT', {
      wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr',
    });
    const INPUT_UNION = koffi.union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT });
    const INPUT = koffi.struct('INPUT', { type: 'uint32', u: INPUT_UNION });
    const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');
    const size = koffi.sizeof(INPUT);
    impl = (sc, flags) => SendInput(1, [{ type: INPUT_KEYBOARD, u: { ki: { wVk: 0, wScan: sc, dwFlags: flags, time: 0, dwExtraInfo: 0 } } }], size);
  } catch (err) {
    loadError = err;
  }
}

function send(code, up) {
  const k = lookup(code);
  if (!k) return false;
  load();
  if (!impl) return false;
  const flags = KEYEVENTF_SCANCODE | (k.ext ? KEYEVENTF_EXTENDEDKEY : 0) | (up ? KEYEVENTF_KEYUP : 0);
  return impl(k.sc, flags) === 1;
}

module.exports = {
  press: (code) => send(code, false),
  release: (code) => send(code, true),
  /** 키를 보낼 수 있는 환경인지 (처음 부르면 koffi 를 불러 본다) */
  get available() {
    load();
    return !!impl;
  },
  get error() {
    load();
    return loadError ? loadError.message : null;
  },
};
