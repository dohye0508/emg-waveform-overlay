'use strict';

// npm run test:keys — 실제 SendInput 으로 보낸 키가 포커스된 창에 keydown/keyup 으로 도착하는지 본다 (hold / tap).
// 이 시험이 도는 동안 키보드를 건드리지 말 것 (다른 창에 SPACE 가 들어가지 않게 시험 창이 포커스를 잡고 있다).

const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const { KeyEngine } = require('../src/main/engine');
const keysender = require('../src/main/keysender');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let code = 1;
  try {
    assert.ok(keysender.available, 'koffi/SendInput 를 쓸 수 없습니다: ' + keysender.error);
    const win = new BrowserWindow({ width: 400, height: 300, show: true, webPreferences: { sandbox: false, contextIsolation: false } });
    await win.loadURL('data:text/html,<body><script>window.ev=[];' +
      "addEventListener('keydown',e=>ev.push(['down',e.code,e.isTrusted,e.repeat]));" +
      "addEventListener('keyup',e=>ev.push(['up',e.code,e.isTrusted]));</script></body>");
    win.focus();
    await sleep(500);
    const events = () => win.webContents.executeJavaScript('JSON.stringify(window.ev.splice(0))').then(JSON.parse);

    const engine = new KeyEngine({ send: (a, c) => (a === 'down' ? keysender.press(c) : keysender.release(c)) });
    engine.configure({ threshold: 10, releaseRatio: 0.7, mode: 'hold', code: 'KeyZ' });
    engine.setEnabled(true, 0);

    // hold: 켜질 때 keydown, 꺼질 때 keyup
    engine.update(20, 1);
    await sleep(200);
    engine.update(1, 2);
    await sleep(200);
    let ev = (await events()).filter((e) => e[3] !== true);
    assert.deepStrictEqual(ev.map((e) => e[0] + ':' + e[1]), ['down:KeyZ', 'up:KeyZ'], 'hold ' + JSON.stringify(ev));
    assert.ok(ev.every((e) => e[2] === true), 'isTrusted');

    // tap: 한 번 눌렀다 뗀다
    engine.configure({ mode: 'tap', tapMs: 30, cooldownMs: 120, code: 'Space' });
    engine.update(20, 1000);
    await sleep(60);
    engine.tick(Date.now() + 1000);
    engine.tick(1031);
    await sleep(200);
    ev = (await events()).filter((e) => e[3] !== true);
    assert.deepStrictEqual(ev.map((e) => e[0] + ':' + e[1]), ['down:Space', 'up:Space'], 'tap ' + JSON.stringify(ev));

    // 화살표(확장 키)
    engine.update(1, 1100);
    engine.configure({ mode: 'hold', code: 'ArrowUp' });
    engine.update(20, 1200);
    await sleep(150);
    engine.update(1, 1300);
    await sleep(150);
    ev = (await events()).filter((e) => e[3] !== true);
    assert.deepStrictEqual(ev.map((e) => e[0] + ':' + e[1]), ['down:ArrowUp', 'up:ArrowUp'], 'arrow ' + JSON.stringify(ev));

    // 눌린 채로 끄면 뗀다
    engine.update(20, 2000);
    await sleep(100);
    engine.setEnabled(false, 2100);
    await sleep(150);
    ev = (await events()).filter((e) => e[3] !== true);
    assert.deepStrictEqual(ev.map((e) => e[0]), ['down', 'up'], 'release on stop ' + JSON.stringify(ev));

    console.log('키 입력 통합 시험 통과 (hold / tap / 확장 키 / 정지 시 떼기)');
    code = 0;
  } catch (err) {
    console.error('실패:', err.message);
  }
  app.exit(code);
});
