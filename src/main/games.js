'use strict';

// 사용자 모드의 게임 목록과, 게임 중 키 엔진에 줄 설정. 화면(Electron)을 몰라서 테스트할 수 있다.
//   gd     : RobTop 공식 웹 데모(1단계 Stereo Madness)를 그대로 띄운다. 인터넷이 필요하다.
//   flappy : 앱에 들어 있는 nebez/floppybird (Apache-2.0, games/flappy/SOURCE.md). 쉬운 모드(틈 200)로 연다. 오프라인.
// 게임 중에는 게임이 정한 단계(보통 1단계, 인베이더는 2단계)와 사용자가 고른 키를 쓴다. 역치·타이밍은 관리자 설정을 그대로 쓴다.

const GAMES = [
  { id: 'gd', name: 'Geometry Dash', url: 'https://www.geometrydash.com/game/index.html', mode: 'hold', defaultKey: 'Space', online: true },
  { id: 'flappy', name: 'Flappy Bird', file: 'games/flappy/index.html', search: '?easy', fitHeight: 525, // #gamecontainer 의 min-height. 이보다 작게 맞추면 아래(땅)가 잘린다
    // 원래 휴대폰(가로 320px) 화면용 게임이라 가운데 480px 칸에서만 돌리고 양옆은 비운다.
    // 파이프는 원래 x=900 에서 출발하므로 칸 오른쪽(500)에서 출발하게 고치고, 속도(1000px/7.5초)는 그대로 둔다.
    // 시작·점수 화면은 320px 기준 위치라 480px 가운데로 옮긴다(+80px).
    css: [
      'html, body { background: #0E1220 !important; }',
      '* { image-rendering: pixelated; }',
      '#gamecontainer { width: 480px !important; margin: 0 auto !important; overflow: hidden !important; box-shadow: 0 0 60px rgba(0,0,0,0.7); }',
      // 같은 이름(animPipe)으로 덮으면 원래 것이 이겨서 새 이름을 쓴다
      '@keyframes animPipeNarrow { 0% { left: 500px; } 100% { left: -100px; } }',
      '.pipe { -webkit-animation: animPipeNarrow 4500ms linear !important; animation: animPipeNarrow 4500ms linear !important; }',
      // 화면 왼쪽 아래 만든 사람 표시는 숨긴다 (출처·라이선스는 games/flappy/SOURCE.md, LICENSE 에 있다)
      '#footer { display: none !important; }',
      '#splash { left: 145px !important; } #scoreboard { left: 123px !important; } #bigscore { left: 230px !important; }',
    ].join(' '),
    mode: 'tap', defaultKey: 'Space', online: false },
  // 얼음과 불의 춤: Steam 에 깔린 Windows 게임. 미리 켜 두면 시작할 때 그 창을 앞으로 가져오기만 한다.
  // 게임이 Esc 를 일시정지로 쓰므로 사용자 화면으로 돌아오는 키는 Ctrl+Q. 돌아와도 게임은 끄지 않는다.
  // 박자마다 한 번씩 누르는 게임이라 '한 번만'(tap). 키는 Windows 입력(SendInput)으로 앞에 있는 게임 창에 간다.
  { id: 'adofai', name: '얼음과 불의 춤', native: true, windowTitle: 'A Dance of Fire and Ice', launchUrl: 'steam://rungameid/977950',
    exitAccel: 'Ctrl+Q', mode: 'tap', defaultKey: 'Space', online: false },
  // 스페이스 인베이더: trungvose/space-invaders-phaser-3 (MIT, Phaser 3, games/invaders/SOURCE.md). 2단계: 약하게 = ←, 세게 = →, 발사는 자동.
  // 화면이 800×600 고정이라 높이에 맞춰 확대한다 (페이지가 가운데 정렬).
  { id: 'invaders', name: 'Space Invaders', file: 'games/invaders/index.html', fitHeight: 600,
    levels: 2, mode: 'hold', defaultKey: 'ArrowLeft', defaultKey2: 'ArrowRight', online: false },
  // 스택: zurkon/playstack (MIT, Three.js, games/stack/SOURCE.md). 힘을 줄 때마다 블록 하나를 놓는다.
  { id: 'stack', name: 'Stack', file: 'games/stack/index.html', mode: 'tap', defaultKey: 'Space', online: false },
  // 벽돌깨기: toji/spookyball (MIT, WebGPU, games/breakout/SOURCE.md). 2단계: 약하게 = ←, 세게 = →, 움직이면 공도 발사된다.
  { id: 'breakout', name: '벽돌깨기', file: 'games/breakout/index.html', levels: 2, mode: 'hold',
    defaultKey: 'ArrowLeft', defaultKey2: 'ArrowRight', online: false },
  // 비행기(헬리콥터류): orangespaceman/js-canvas-copter (WTFPL) 물리·틀 + Kenney Tappy Plane (CC0) 그림 (games/copter/SOURCE.md). 힘을 주는 동안 상승.
  { id: 'copter', name: 'Helicopter Game', file: 'games/copter/index.html', mode: 'hold', defaultKey: 'Space', online: false },
];

// 게임 안에서 나가기(Esc)와 겹치는 키는 고를 수 없다
const BLOCKED = new Set(['Escape']);

function gameById(id) {
  return GAMES.find((g) => g.id === id) || null;
}

/** 게임 중 키 엔진 설정 (관리자 설정 위에 게임 키·방식만 덮는다) */
function engineConfigFor(game, settings) {
  const key = (settings.user && settings.user.keys && settings.user.keys[game.id]) || game.defaultKey;
  const key2 = (settings.user && settings.user.keys2 && settings.user.keys2[game.id]) || game.defaultKey2 || settings.key.code2;
  return {
    threshold: settings.trigger.threshold,
    threshold2: settings.trigger.threshold2,
    releaseRatio: settings.trigger.releaseRatio,
    levels: game.levels === 2 ? 2 : 1,
    mode: game.mode,
    tapMs: settings.key.tapMs,
    cooldownMs: settings.key.cooldownMs,
    decideMs: settings.key.decideMs,
    code: key,
    code2: key2,
  };
}

module.exports = { GAMES, BLOCKED, gameById, engineConfigFor };
