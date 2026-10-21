'use strict';

// 사용자 모드의 게임 목록과, 게임 중 키 엔진에 줄 설정. 화면(Electron)을 몰라서 테스트할 수 있다.
//   gd     : RobTop 공식 웹 데모(1단계 Stereo Madness)를 그대로 띄운다. 인터넷이 필요하다.
//   flappy : 앱에 들어 있는 nebez/floppybird (Apache-2.0, games/flappy/SOURCE.md). 쉬운 모드(틈 200)로 연다. 오프라인.
// 게임 중에는 1단계로, 사용자가 고른 키 하나만 쓴다. 역치·타이밍은 관리자 설정을 그대로 쓴다.

const GAMES = [
  { id: 'gd', name: 'Geometry Dash', url: 'https://www.geometrydash.com/game/index.html', mode: 'hold', defaultKey: 'Space', online: true },
  { id: 'flappy', name: 'Flappy Bird', file: 'games/flappy/index.html', search: '?easy', fitHeight: 470,
    // 원래 휴대폰(가로 320px) 화면용 게임이라 가운데 480px 칸에서만 돌리고 양옆은 비운다.
    // 파이프는 원래 x=900 에서 출발하므로 칸 오른쪽(500)에서 출발하게 고치고, 속도(1000px/7.5초)는 그대로 둔다.
    // 시작·점수 화면은 320px 기준 위치라 480px 가운데로 옮긴다(+80px).
    css: [
      'html, body { background: #0E1220 !important; }',
      '#gamecontainer { width: 480px !important; margin: 0 auto !important; overflow: hidden !important; box-shadow: 0 0 60px rgba(0,0,0,0.7); }',
      // 같은 이름(animPipe)으로 덮으면 원래 것이 이겨서 새 이름을 쓴다
      '@keyframes animPipeNarrow { 0% { left: 500px; } 100% { left: -100px; } }',
      '.pipe { -webkit-animation: animPipeNarrow 4500ms linear !important; animation: animPipeNarrow 4500ms linear !important; }',
      // 화면 왼쪽 아래 만든 사람 표시는 숨긴다 (출처·라이선스는 games/flappy/SOURCE.md, LICENSE 에 있다)
      '#footer { display: none !important; }',
      '#splash { left: 145px !important; } #scoreboard { left: 123px !important; } #bigscore { left: 230px !important; }',
    ].join(' '),
    mode: 'tap', defaultKey: 'Space', online: false },
];

// 게임 안에서 나가기(Esc)와 겹치는 키는 고를 수 없다
const BLOCKED = new Set(['Escape']);

function gameById(id) {
  return GAMES.find((g) => g.id === id) || null;
}

/** 게임 중 키 엔진 설정 (관리자 설정 위에 게임 키·방식만 덮는다) */
function engineConfigFor(game, settings) {
  const key = (settings.user && settings.user.keys && settings.user.keys[game.id]) || game.defaultKey;
  return {
    threshold: settings.trigger.threshold,
    threshold2: settings.trigger.threshold2,
    releaseRatio: settings.trigger.releaseRatio,
    levels: 1,
    mode: game.mode,
    tapMs: settings.key.tapMs,
    cooldownMs: settings.key.cooldownMs,
    decideMs: settings.key.decideMs,
    code: key,
    code2: settings.key.code2,
  };
}

module.exports = { GAMES, BLOCKED, gameById, engineConfigFor };
