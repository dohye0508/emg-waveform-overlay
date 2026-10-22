import Phaser from '../lib/phaser.js'

// EMG Overlay: 템플릿의 GameOver 장면을 결과판으로 바꿈. 높이·코인·점수·최고 점수, 끝나고 1.2초 뒤 아무 키(Esc 빼고)로 다시 시작.
const TEXT = { fontFamily: 'Jua, "Malgun Gothic", sans-serif', color: '#ffffff', stroke: '#22426b', strokeThickness: 7 }

export default class GameOver extends Phaser.Scene
{
	constructor()
	{
		super('game-over')
	}

	create(data)
	{
		const width = this.scale.width
		const height = this.scale.height
		const score = data.score || 0
		let best = 0
		try { best = Number(localStorage.getItem('bunnyBest')) || 0 } catch (e) { /* ignore */ }
		const newBest = score > best
		if (newBest)
		{
			best = score
			try { localStorage.setItem('bunnyBest', String(best)) } catch (e) { /* ignore */ }
		}

		// 떨어진 높이의 하늘색 그대로
		const [top, bottom] = data.sky || [0x3fa9ff, 0xbfeaff]
		this.add.graphics().fillGradientStyle(top, top, bottom, bottom, 1).fillRect(0, 0, width, height)
		this.add.image(width / 2, height - 512 * 0.9 + 205, 'bg_layer4').setScale(0.9)

		const title = this.add.text(width / 2, height * 0.14, '게임 오버', { ...TEXT, fontSize: 68, stroke: '#a33b2b', strokeThickness: 11, color: '#ffe1d4' }).setOrigin(0.5).setScale(0)
		this.tweens.add({ targets: title, scale: 1, duration: 450, ease: 'Back.out' })

		const pw = 380, ph = 310, px = width / 2 - pw / 2, py = height * 0.24
		const panel = this.add.container(0, 60).setAlpha(0)
		const g = this.add.graphics()
		g.fillStyle(0x22426b, 0.3).fillRoundedRect(px + 6, py + 10, pw, ph, 28)
		g.fillStyle(0xfff6e0, 1).fillRoundedRect(px, py, pw, ph, 28)
		g.lineStyle(6, 0xe6b980, 1).strokeRoundedRect(px, py, pw, ph, 28)
		panel.add(g)
		panel.add(this.add.image(px + 78, py + 160, 'bunny1_hurt').setScale(0.6))
		const row = (label, value, y, color) => {
			panel.add(this.add.text(px + 160, py + y, label, { ...TEXT, fontSize: 25, color: '#c0612b', strokeThickness: 0 }).setOrigin(0, 0.5))
			panel.add(this.add.text(px + pw - 28, py + y, value, { ...TEXT, fontSize: 34, color: color || '#ffffff' }).setOrigin(1, 0.5))
		}
		row('높이', `${data.height || 0}m`, 60)
		row('코인', `${data.coins || 0}개`, 118)
		row('점수', `${score}`, 180, '#ffe066')
		row(newBest ? '새 기록!' : '최고', `${best}`, 248, newBest ? '#ff9f7a' : '#ffffff')
		this.tweens.add({ targets: panel, y: 0, alpha: 1, duration: 500, delay: 150, ease: 'Back.out' })

		const again = this.add.text(width / 2, py + ph + 70, '힘을 주면 다시 시작', { ...TEXT, fontSize: 36 }).setOrigin(0.5).setAlpha(0)
		const shownAt = this.time.now
		this.time.delayedCall(1200, () => {
			again.setAlpha(1)
			this.tweens.add({ targets: again, scale: 1.1, alpha: 0.4, duration: 550, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
		})
		const restart = () => { if (this.time.now - shownAt > 1200) this.scene.start('game') }
		this.input.keyboard.on('keydown', (e) => { if (e.key !== 'Escape') restart() })
		this.input.on('pointerdown', restart)
	}
}
