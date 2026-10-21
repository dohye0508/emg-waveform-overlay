'use strict';

// 사용자 모드의 게임 목록과, 게임 중 키 엔진에 줄 설정. 화면(Electron)을 몰라서 테스트할 수 있다.
//   gd     : RobTop 공식 웹 데모(1단계 Stereo Madness)를 그대로 띄운다. 인터넷이 필요하다.
//   flappy : 앱에 들어 있는 nebez/floppybird (Apache-2.0, games/flappy/SOURCE.md). 쉬운 모드(틈 200)로 연다. 오프라인.
// 게임 중에는 1단계로, 사용자가 고른 키 하나만 쓴다. 역치·타이밍은 관리자 설정을 그대로 쓴다.

const GAMES = [
  { id: 'gd', name: 'Geometry Dash', url: 'https://www.geometrydash.com/game/index.html', mode: 'hold', defaultKey: 'Space', online: true },
  { id: 'flappy', name: 'Flappy Bird', file: 'games/flappy/index.html', search: '?easy', fitHeight: 600, mode: 'tap', defaultKey: 'Space', online: false },
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
