'use strict';

// EMG Overlay: 비행기 게임 그리기. 게임 규칙·물리는 script.js(js-canvas-copter 기반)이고,
// 그림은 Kenney "Tappy Plane"(CC0, assets/Kenney-License.txt)의 그림 조각으로 그린다.
//   하늘 배경(시차 스크롤), 바닥 풀밭·천장 바위 띠, 바위 첨탑, 별, 프로펠러가 도는 비행기, 연기,
//   추락하면 비행기가 빙글 떨어지고 연기가 터진다. 점수는 Kenney 숫자 그림, 안내는 한국어.

(function () {
  var game = window.jsCopter;
  var canvas = game.canvas;
  var ctx = canvas.getContext('2d');
  var W = game.options.canvas.width;
  var H = game.options.canvas.height;
  var k = 1;
  var particles = [];
  var lastT = performance.now();
  var idle = 0;

  function resize() {
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    k = canvas.height / H;
  }
  window.addEventListener('resize', resize);
  resize();

  // ───────── 그림 불러오기 ─────────
  var img = {};
  var names = ['background', 'groundGrass', 'groundRock', 'rock', 'rockDown', 'rockGrass', 'rockGrassDown', 'puffLarge', 'puffSmall',
    'starGold', 'planeRed1', 'planeRed2', 'planeRed3', 'textGetReady', 'textGameOver', 'tap', 'tapLeft', 'tapRight', 'tapTick',
    'UIbg', 'medalBronze', 'medalSilver', 'medalGold'];
  names.forEach(function (n) { img[n] = new Image(); img[n].src = 'assets/' + n + '.png'; });
  var digits = [];
  for (var d = 0; d < 10; d++) { digits[d] = new Image(); digits[d].src = 'assets/numbers/number' + d + '.png'; }
  function ready(i) { return i && i.complete && i.naturalWidth > 0; }

  // ───────── 그리기 조각 ─────────
  function tileX(image, offset, y, h) {
    if (!ready(image)) return;
    var w = image.naturalWidth * (h / image.naturalHeight);
    var x = -((offset % w) + w) % w;
    for (; x < W; x += w) ctx.drawImage(image, x, y, w + 0.5, h);
  }

  // 바닥 풀밭 띠와 천장 바위 띠 (뒤집어서). 띠 두께는 판정 두께보다 조금 두꺼워 언덕이 보인다.
  function drawGround(scroll) {
    var g = game.gameData.walls.currentHeight / 2;
    var bandH = g + 30;
    tileX(img.groundGrass, scroll, H - bandH, bandH);
    ctx.save();
    ctx.translate(0, bandH);
    ctx.scale(1, -1);
    tileX(img.groundRock, scroll * 1.0 + 300, 0, bandH);
    ctx.restore();
  }

  function drawSpires() {
    var obs = game.gameData.obstacles.current;
    for (var j = 0; j < obs.length; j++) {
      var o = obs[j];
      var pic = o.up ? (o.x % 3 < 1.5 ? img.rockGrass : img.rock) : (o.x % 3 < 1.5 ? img.rockGrassDown : img.rockDown);
      if (!ready(pic)) continue;
      // 그림의 밑동이 띠 속에 묻히게 조금 더 길게
      var extra = 26;
      if (o.up) ctx.drawImage(pic, o.x, o.base - o.h, o.w, o.h + extra);
      else ctx.drawImage(pic, o.x, o.base - extra, o.w, o.h + extra);
    }
  }

  function drawStars(t) {
    var stars = game.gameData.stars || [];
    for (var j = 0; j < stars.length; j++) {
      var s = stars[j];
      if (!ready(img.starGold)) continue;
      var size = 34;
      if (s.got) {
        var a = (Date.now() - s.gotAt) / 400;
        if (a > 1) continue;
        ctx.save();
        ctx.globalAlpha = 1 - a;
        var sz = size * (1 + a * 1.5);
        ctx.drawImage(img.starGold, s.x - sz / 2, s.y - sz / 2 - a * 30, sz, sz);
        ctx.restore();
        continue;
      }
      var bob = Math.sin(t / 250 + s.x / 50) * 4;
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      ctx.rotate(Math.sin(t / 400 + s.x) * 0.15);
      ctx.shadowColor = 'rgba(255, 220, 80, 0.9)';
      ctx.shadowBlur = 16;
      ctx.drawImage(img.starGold, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  // 비행기: 판정 상자(50×30)보다 조금 크게, 가운데 맞춰 그린다
  var crashFall = null;
  function drawPlane(x, y, rot, t) {
    var frame = [img.planeRed1, img.planeRed2, img.planeRed3, img.planeRed2][Math.floor(t / 45) % 4];
    if (!ready(frame)) return;
    var w = 70, h = w * (73 / 88);
    var cw = game.options.copter.width, ch = game.options.copter.height;
    ctx.save();
    ctx.translate(x + cw / 2, y + ch / 2);
    ctx.rotate(rot * 1.6);
    ctx.drawImage(frame, -w / 2, -h / 2 - 2, w, h);
    ctx.restore();
  }

  function puff(x, y, big, vx, vy, life) {
    particles.push({ x: x, y: y, vx: vx, vy: vy, life: life || 1, big: big, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.1, s: 0.6 + Math.random() * 0.5 });
  }

  function drawParticles(dt) {
    for (var j = particles.length - 1; j >= 0; j--) {
      var p = particles[j];
      p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.rot += p.vr;
      p.life -= dt * 1.3;
      if (p.life <= 0) { particles.splice(j, 1); continue; }
      var pic = p.big ? img.puffLarge : img.puffSmall;
      if (!ready(pic)) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      var sc = p.s * (1.6 - p.life * 0.6);
      ctx.drawImage(pic, -pic.naturalWidth * sc / 2, -pic.naturalHeight * sc / 2, pic.naturalWidth * sc, pic.naturalHeight * sc);
      ctx.restore();
    }
  }

  // Kenney 숫자 그림으로 큰 점수
  function drawNumber(n, cx, y, height) {
    var str = String(n);
    var ws = [], total = 0;
    for (var i = 0; i < str.length; i++) {
      var di = digits[+str[i]];
      var w = ready(di) ? di.naturalWidth * (height / di.naturalHeight) : height * 0.68;
      ws.push(w); total += w + 2;
    }
    var x = cx - total / 2;
    for (i = 0; i < str.length; i++) {
      if (ready(digits[+str[i]])) ctx.drawImage(digits[+str[i]], x, y, ws[i], height);
      x += ws[i] + 2;
    }
  }

  function text(str, x, y, size, color, align) {
    ctx.save();
    ctx.font = size + "px Jua, 'Malgun Gothic', sans-serif";
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size / 5;
    ctx.strokeStyle = 'rgba(40, 70, 110, 0.9)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  function drawImg(i, cx, cy, w) {
    if (!ready(i)) return;
    var h = w * i.naturalHeight / i.naturalWidth;
    ctx.drawImage(i, cx - w / 2, cy - h / 2, w, h);
  }

  // ───────── 한 프레임 ─────────
  var wasRunning = false;
  var shake = 0;
  var lastPuff = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    var dd = game.gameData;
    var running = game.gameRunning;
    if (!running) idle += dt * 60 * game.options.copter.topSpeed * 0.4;
    var c = dd.copter;
    var cw = game.options.copter.width, ch = game.options.copter.height;

    if (wasRunning && !running && dd.crashedAt) {
      // 추락: 연기가 터지고 비행기가 빙글 떨어진다
      for (var j = 0; j < 14; j++) puff(c.x + cw / 2, c.y + ch / 2, j % 2 === 0, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, 1.2);
      crashFall = { x: c.x, y: c.y, vy: -5, rot: c.rotation };
      shake = 1;
    }
    if (running) crashFall = null;
    wasRunning = running;
    var scroll = dd.distance + idle;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var sx = 0, sy = 0;
    if (shake > 0) { sx = (Math.random() - 0.5) * 14 * shake; sy = (Math.random() - 0.5) * 14 * shake; shake -= dt * 1.8; }
    ctx.setTransform(k, 0, 0, k, sx, sy);
    ctx.imageSmoothingQuality = 'high';

    // 하늘
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#bfe3f5');
    sky.addColorStop(1, '#e6f5fb');
    ctx.fillStyle = sky;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    tileX(img.background, scroll * 0.25, 0, H);

    drawStars(now);
    drawSpires();
    drawGround(scroll);

    // 비행기와 연기
    if (running) {
      if (now - lastPuff > (game.mouseDown ? 70 : 140)) {
        lastPuff = now;
        puff(c.x - 4, c.y + ch / 2 + (Math.random() - 0.5) * 6, false, -game.options.copter.topSpeed * 0.6, (Math.random() - 0.5) * 0.6, 0.9);
      }
      drawPlane(c.x, c.y, c.rotation, now);
    } else if (crashFall) {
      crashFall.vy += 0.5 * dt * 60;
      crashFall.y += crashFall.vy * dt * 60;
      crashFall.rot += 0.12 * dt * 60;
      if (crashFall.y < H + 80) drawPlane(crashFall.x, crashFall.y, crashFall.rot, now);
    } else {
      // 시작 전: 가운데서 둥실
      drawPlane(c.x, H / 2 - ch / 2 + Math.sin(now / 300) * 10, Math.sin(now / 500) * 0.05, now);
    }
    drawParticles(dt);

    var score = game.scores.current;
    var best = Math.max(game.scores.top || 0, score);

    if (running) {
      drawNumber(score, W / 2, 62, 70);
    } else if (!dd.crashedAt) {
      drawImg(img.textGetReady, W / 2, H * 0.27, 380);
      var px = c.x + cw / 2, py = H / 2 + Math.sin(now / 300) * 10;
      drawImg(img.tapLeft, px - 100, py, 90);
      drawImg(img.tapRight, px + 100, py, 90);
      if (Math.floor(now / 350) % 2 === 0) drawImg(img.tapTick, px + 4, py + 62, 46);
      drawImg(img.tap, px + 14, py + 92, 52);
      text('힘을 주는 동안 위로 올라가요', W / 2, H * 0.74, 26, '#ffffff');
      text('바위를 피하고 별을 모으세요', W / 2, H * 0.82, 20, '#fff3c4');
    } else {
      // 결과 판
      drawImg(img.textGameOver, W / 2, H * 0.2, 380);
      var bw = 300, bh = 190, bx = W / 2 - bw / 2, by = H * 0.3;
      if (ready(img.UIbg)) ctx.drawImage(img.UIbg, bx, by, bw, bh);
      var medal = score >= 40 ? img.medalGold : score >= 20 ? img.medalSilver : score >= 8 ? img.medalBronze : null;
      if (medal) drawImg(medal, bx + 72, by + bh / 2 + 4, 92);
      else text('메달 없음', bx + 72, by + bh / 2, 18, '#c9b28a');
      // 숫자는 점수·최고 모두 Kenney 숫자 그림, 글자는 모두 주아체로 맞춘다
      text('점수', bx + 205, by + 32, 20, '#e8a33d');
      drawNumber(score, bx + 205, by + 46, 44);
      text(score > 0 && score >= best ? '최고 (새 기록!)' : '최고', bx + 205, by + 112, 20, '#e8a33d');
      drawNumber(best, bx + 205, by + 126, 44);
      if (Date.now() - dd.crashedAt > 1200 && Math.floor(now / 450) % 2 === 0) text('힘을 주면 다시 시작', W / 2, by + bh + 46, 26, '#ffffff');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
