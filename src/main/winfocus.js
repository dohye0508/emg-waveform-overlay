'use strict';

// 다른 프로그램(Steam 게임 등)의 창을 제목으로 찾고 맨 앞으로 가져온다 (koffi 로 user32 호출).
// Windows 는 뒤에 있는 프로그램이 다른 창을 앞으로 가져오는 것을 막을 때가 있어서,
// 지금 앞에 있는 창의 입력 스레드에 잠깐 붙고(AttachThreadInput) Alt 키를 한 번 눌러 허용을 받는다.
// Windows 가 아니거나 koffi 를 못 불러오면 available = false 이고 아무것도 하지 않는다.

let api = null;
let loadError = null;

function load() {
  if (api || loadError) return;
  if (process.platform !== 'win32') {
    loadError = new Error('Windows 에서만 됩니다');
    return;
  }
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    api = {
      koffi,
      FindWindowW: user32.func('void * __stdcall FindWindowW(str16 lpClassName, str16 lpWindowName)'),
      IsWindow: user32.func('bool __stdcall IsWindow(void *hWnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(void *hWnd)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(void *hWnd, int nCmdShow)'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void *hWnd)'),
      BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(void *hWnd)'),
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, void *lpdwProcessId)'),
      AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'),
      GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
    };
  } catch (err) {
    loadError = err;
  }
}

const SW_RESTORE = 9;
const VK_MENU = 0x12;
const KEYEVENTF_KEYUP = 0x0002;

const addr = (h) => (h ? api.koffi.address(h) : 0n);

/** 제목이 정확히 같은 최상위 창. 없으면 null */
function find(title) {
  load();
  if (!api) return null;
  const h = api.FindWindowW(null, title);
  return h && addr(h) !== 0n ? h : null;
}

function exists(title) {
  return !!find(title);
}

function isForeground(h) {
  load();
  if (!api || !h) return false;
  return addr(api.GetForegroundWindow()) === addr(h);
}

/** 창을 맨 앞으로. 앞으로 왔으면 true */
function focus(h) {
  load();
  if (!api || !h || !api.IsWindow(h)) return false;
  if (api.IsIconic(h)) api.ShowWindow(h, SW_RESTORE);
  const fg = api.GetForegroundWindow();
  const cur = api.GetCurrentThreadId();
  const fgThread = fg ? api.GetWindowThreadProcessId(fg, null) : 0;
  const attached = fgThread && fgThread !== cur ? api.AttachThreadInput(cur, fgThread, true) : false;
  try {
    // Alt 를 눌렀다 떼면 Windows 가 이 프로세스의 SetForegroundWindow 를 허용한다
    api.keybd_event(VK_MENU, 0, 0, 0);
    api.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
    api.BringWindowToTop(h);
    api.SetForegroundWindow(h);
  } finally {
    if (attached) api.AttachThreadInput(cur, fgThread, false);
  }
  return isForeground(h);
}

module.exports = {
  find,
  exists,
  focus,
  isForeground,
  get available() {
    load();
    return !!api;
  },
  get error() {
    load();
    return loadError ? loadError.message : null;
  },
};
