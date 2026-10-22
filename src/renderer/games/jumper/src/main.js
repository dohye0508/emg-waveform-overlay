import Phaser from './lib/phaser.js'

import Game from './scenes/Game.js'
import GameOver from './scenes/GameOver.js'

// EMG Overlay: Phaser 는 CDN 대신 앱에 넣은 vendor/phaser.min.js (3.55.2) 를 쓴다.
// 화면은 세로 480×720 을 창 높이에 맞춰 가운데에 놓고 (양옆은 하늘색 배경), 물리 디버그 상자는 끈다.
// 한글 글꼴(주아체)이 로드된 뒤에 게임을 시작해 글자가 기본 글꼴로 먼저 그려지지 않게 한다.
document.fonts.load('32px Jua').finally(() => {
	window.__game = new Phaser.Game({
		type: Phaser.AUTO,
		width: 480,
		height: 720,
		transparent: true,
		scale: {
			mode: Phaser.Scale.FIT,
			autoCenter: Phaser.Scale.CENTER_BOTH
		},
		scene: [Game, GameOver],
		physics: {
			default: 'arcade',
			arcade: {
				gravity: {
					y: 1300
				},
				debug: false
			}
		}
	})
})
