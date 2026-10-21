'use strict';

// 개발용: node test/layout.check.js [port] [screenshot-dir] [index.html|home.html]
// 실행 중인 앱(--remote-debugging-port)의 설정 화면을 여러 창 크기로 열어 넘치거나 줄바꿈된 요소가 0개인지 본다.

const fs = require('fs');
const path = require('path');

const port = Number(process.argv[2]) || 9333;
const shotDir = process.argv[3];
const pageMatch = process.argv[4] || 'index.html'; // 사용자 화면은 home.html

async function connect(match) {
  const list = await (await fetch(`http://localhost:${port}/json`)).json();
  const page = list.find((p) => p.url.includes(match));
  if (!page) throw new Error(match + ' 창을 찾지 못했습니다');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
  return { send, evaluate, close: () => ws.close() };
}

// 요소가 부모 밖으로 나가거나, 글자가 잘리거나, 여러 줄이 된 경우를 찾는다
const CHECK = `(() => {
  const bad = [];
  const root = document.querySelector('#app') || document.body;
  const rr = root.getBoundingClientRect();
  document.querySelectorAll('#app *, .card *').forEach((e) => {
    if (e.hidden || e.closest('[hidden]')) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const name = e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ').join('.') : '') + ' "' + (e.textContent || '').trim().slice(0, 16) + '"';
    if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible' && e.children.length === 0 && cs.textOverflow === 'ellipsis') bad.push('말줄임 발생: ' + name);
    const p = e.parentElement;
    if (p && p !== document.body) {
      const pr = p.getBoundingClientRect();
      if (r.right > pr.right + 1.5 || r.left < pr.left - 1.5) bad.push('부모 밖(가로): ' + name);
    }
    if (r.right > rr.right + 1.5 || r.bottom > rr.bottom + 1.5) bad.push('화면 밖: ' + name);
    if (e.children.length === 0 && e.textContent.trim() && cs.display !== 'inline') {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      if (r.height > lh * 1.6 && cs.whiteSpace !== 'nowrap' && !e.matches('.warn')) bad.push('줄바꿈: ' + name);
    }
  });
  return bad;
})()`;

(async () => {
  let failed = 0;
  const win = await connect(pageMatch);
  for (const [w, h] of [[1440, 900], [1280, 720], [1024, 640], [800, 600]]) {
    await win.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 400));
    const bad = await win.evaluate(CHECK);
    console.log(`${pageMatch} ${w}x${h}: 문제 ${bad.length}개`);
    bad.forEach((b) => console.log('   ' + b));
    failed += bad.length;
    if (shotDir) {
      const shot = await win.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, `${pageMatch.replace('.html', '')}-${w}x${h}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await win.send('Emulation.clearDeviceMetricsOverride');
  win.close();

  const ov = await connect('overlay.html');
  for (const s of [50, 100, 200]) {
    const w = Math.round(360 * s / 100), h = Math.round(176 * s / 100);
    await ov.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    const bad = await ov.evaluate(CHECK.replace("'#app'", "'#card'"));
    console.log(`오버레이 ${s}%: 문제 ${bad.length}개`);
    bad.forEach((b) => console.log('   ' + b));
    failed += bad.length;
    if (shotDir) {
      const shot = await ov.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(shotDir, `overlay-${s}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await ov.send('Emulation.clearDeviceMetricsOverride');
  ov.close();
  console.log(failed === 0 ? '통과' : `실패: ${failed}개`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
