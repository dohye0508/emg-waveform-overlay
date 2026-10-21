'use strict';

// EMG Overlay: 게임 좌표 높이를 Kenney Tappy Plane 그림의 원래 크기(480)에 맞추고, 가로는 창 비율대로 늘린다.
// 원작 js-canvas-copter 는 높이 300 기준이라 속도·중력 같은 값을 1.6배로 맞췄다.
// 동굴 벽은 일정한 두께(바닥·천장 띠)로 두고, 어려움은 바위 첨탑(createObstacles)이 맡는다.
(function () {
  var H = 480;
  var W = Math.round(H * (window.innerWidth / window.innerHeight));
  jsCopter.init('jscopter', 'jscopter-container', {
    canvas: { width: W, height: H, refreshRate: 20 },
    copter: { width: 50, height: 30, startX: Math.round(W * 0.18), topSpeed: 7, acceleration: 0.62 },   // acceleration = 위로 미는 힘
    physics: { terminalVelocity: 7.5, gravity: 0.32, friction: 0.985 },   // friction = 공기 저항 (프레임마다 곱함)
    walls: { separation: 30, width: 32, step: 0, startHeight: 92, maxHeight: 92, heightIncreaseInterval: 0, heightIncreaseStep: 0 },
    obstacles: { separation: 330, width: 48, height: 200 },
  });
})();
