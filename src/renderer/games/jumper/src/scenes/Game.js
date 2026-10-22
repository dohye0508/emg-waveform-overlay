import Phaser from '../lib/phaser.js'
import { sfx } from '../sfx.js'

// EMG Overlay: ourcade "Infinite Jumper" 템플릿(MIT)의 Game 장면을 바탕으로 크게 고쳐 씀.
//   바탕 그대로: 토끼가 저절로 계속 뛰고, ← → 로 좌우 이동, 화면 밖으로 나가면 반대편으로, 먹이 모으기, 떨어지면 끝.
//   고친 것: 카메라는 위로만 부드럽게 따라가고(떨어지면 화면 아래로 사라짐), 하늘이 높이에 따라 낮 → 노을 → 밤(별)으로 바뀌며
//            먼 구름이 흘러간다. 발판은 구름(살랑살랑)·풀·모래·눈·돌(높이에 따라), 좌우로 움직이는 발판, 밟으면 부서지는 발판,
//            스프링, 제트팩, 날개 달린 적(위에서 밟으면 튕김), 도는 코인·금 당근, 토끼 찌그러짐/늘어남·기울기, 먼지·불꽃 입자,
//            최고 기록 선. 그림은 Kenney Jumper Pack(CC0).
const TEXT = { fontFamily: 'Jua, "Malgun Gothic", sans-serif', color: '#ffffff', stroke: '#22426b', strokeThickness: 7 }
const JUMP = -760
const SPRING_JUMP = -1380
const JET_SPEED = -1100
const JET_MS = 2200
const MOVE = 340
const BUNNY = 0.42

// 하늘 색 (높이 m, 위쪽, 아래쪽)
const SKY = [
	[0, 0x3fa9ff, 0xbfeaff],
	[220, 0x4a7dff, 0xffc7a6],
	[420, 0x4b3f9e, 0xff8f9e],
	[650, 0x14205a, 0x4a3f8f],
	[950, 0x050a24, 0x18205a],
]

const lerp = (a, b, t) => a + (b - a) * t
export function mix(c1, c2, t)
{
	const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t), g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t), b = lerp(c1 & 255, c2 & 255, t)
	return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)
}
export function skyAt(h)
{
	for (let i = 1; i < SKY.length; i++)
	{
		if (h <= SKY[i][0])
		{
			const t = (h - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0])
			return [mix(SKY[i - 1][1], SKY[i][1], t), mix(SKY[i - 1][2], SKY[i][2], t)]
		}
	}
	const last = SKY[SKY.length - 1]
	return [last[1], last[2]]
}

export default class Game extends Phaser.Scene
{
	constructor()
	{
		super('game')
	}

	init()
	{
		this.coins = 0
		this.coinPoints = 0
		this.started = false
		this.dying = false
		this.over = false
		this.maxHeight = 0
		this.jetUntil = 0
		this.squash = 0
		this.facing = 1
		this.lastSky = -1
	}

	preload()
	{
		const imgs = ['bg_layer2', 'bg_layer3', 'bg_layer4', 'cloud', 'carrot_gold', 'spring', 'spring_in', 'spring_out', 'coin_gold',
			'bunny1_stand', 'bunny1_jump', 'bunny1_hurt', 'bunny1_ready', 'bunny1_walk1', 'smoke', 'flame', 'particle_brown', 'particle_beige', 'particle_green',
			'grass1', 'grass2', 'grass_brown1', 'mushroom_red', 'mushroom_brown', 'cactus', 'jetpack', 'powerup_jetpack',
			'wingMan1', 'wingMan2', 'wingMan3', 'wingMan4', 'wingMan5', 'gold_1', 'gold_2', 'gold_3', 'gold_4']
		for (const t of ['grass', 'sand', 'snow', 'stone'])
		{
			imgs.push(`ground_${t}`, `ground_${t}_broken`, `ground_${t}_small`, `ground_${t}_small_broken`)
		}
		for (const n of imgs) this.load.image(n, `assets/${n}.png`)
		this.load.audio('jump', 'assets/phaseJump1.wav')
	}

	create()
	{
		const W = this.scale.width, H = this.scale.height
		this.physics.world.gravity.y = 1300
		this.cursors = this.input.keyboard.createCursorKeys()
		try { this.bestHeight = Number(localStorage.getItem('bunnyBestHeight')) || 0 } catch (e) { this.bestHeight = 0 }

		this.makeTextures()
		if (!this.anims.exists('spin'))
		{
			this.anims.create({ key: 'spin', frames: ['gold_1', 'gold_2', 'gold_3', 'gold_4', 'gold_3', 'gold_2'].map((key) => ({ key })), frameRate: 12, repeat: -1 })
			this.anims.create({ key: 'flap', frames: ['wingMan1', 'wingMan2', 'wingMan3', 'wingMan4', 'wingMan5', 'wingMan4', 'wingMan3', 'wingMan2'].map((key) => ({ key })), frameRate: 16, repeat: -1 })
		}

		// 하늘 (높이에 따라 색이 바뀜), 별, 먼 구름, 언덕
		this.sky = this.add.graphics().setScrollFactor(0).setDepth(-20)
		this.stars = []
		for (let i = 0; i < 70; i++)
		{
			const s = this.add.image(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), 'star').setScrollFactor(0).setDepth(-19)
			s.setScale(Phaser.Math.FloatBetween(0.4, 1.2)).setAlpha(0)
			s.tw = Phaser.Math.FloatBetween(0, 6)
			this.stars.push(s)
		}
		this.puffs = []
		for (let i = 0; i < 9; i++)
		{
			const p = this.add.image(Phaser.Math.Between(0, W), H - i * 130, 'puff').setScrollFactor(0, 0.35).setDepth(-15)
			p.setScale(Phaser.Math.FloatBetween(0.5, 1.1)).setAlpha(Phaser.Math.FloatBetween(0.35, 0.7))
			p.vx = Phaser.Math.FloatBetween(6, 22) * (Math.random() < 0.5 ? -1 : 1)
			this.puffs.push(p)
		}
		this.add.image(W / 2, H - 512 * 0.9 + 140, 'bg_layer2').setScale(0.9).setScrollFactor(0, 0.15).setDepth(-12)
		this.add.image(W / 2, H - 512 * 0.9 + 170, 'bg_layer3').setScale(0.9).setScrollFactor(0, 0.3).setDepth(-11)
		this.add.image(W / 2, H - 512 * 0.9 + 205, 'bg_layer4').setScale(0.9).setScrollFactor(0, 0.5).setDepth(-10)

		this.platforms = this.physics.add.group({ allowGravity: false, immovable: true })
		this.springs = this.physics.add.group({ allowGravity: false, immovable: true })
		this.items = this.physics.add.group({ allowGravity: false })
		this.enemies = this.physics.add.group({ allowGravity: false })
		this.decor = []

		// 최고 기록 선
		if (this.bestHeight > 20)
		{
			const by = this.groundY() - this.bestHeight * 10
			const g = this.add.graphics().setDepth(-5)
			g.lineStyle(3, 0xffffff, 0.7)
			for (let x = 0; x < W; x += 24) g.lineBetween(x, by, x + 12, by)
			this.add.text(W - 10, by - 6, `최고 ${this.bestHeight}m`, { ...TEXT, fontSize: 20, strokeThickness: 5 }).setOrigin(1, 1).setDepth(-5)
		}

		// 첫 발판은 토끼 바로 아래, 나머지는 위로 차곡차곡
		const first = this.spawnPlatform(W / 2, this.groundY(), 'ground_grass')
		this.addDecor(first)
		this.nextY = this.groundY() - 100

		// 토끼: 물리 몸통(안 보임) + 보이는 그림 (찌그러짐·기울기를 따로 준다)
		this.player = this.physics.add.sprite(W / 2, this.groundY() - 52, 'bunny1_stand').setScale(BUNNY).setVisible(false)
		this.player.body.setSize(70, 175).setOffset(25, 26)
		this.player.body.checkCollision.up = false
		this.player.body.checkCollision.left = false
		this.player.body.checkCollision.right = false
		this.bunny = this.add.image(this.player.x, this.player.y, 'bunny1_ready').setScale(BUNNY).setDepth(5)
		this.jetImg = this.add.image(0, 0, 'jetpack').setScale(0.38).setDepth(4).setVisible(false)

		this.physics.add.collider(this.player, this.platforms, this.land, this.canLand, this)
		this.physics.add.overlap(this.player, this.springs, this.hitSpring, undefined, this)
		this.physics.add.overlap(this.player, this.items, this.collect, undefined, this)
		this.physics.add.overlap(this.player, this.enemies, this.hitEnemy, undefined, this)

		// 입자: 착지 먼지, 부서진 조각, 제트팩 불꽃, 반짝이
		this.dustFx = this.add.particles('smoke').setDepth(4).createEmitter({
			on: false, speedX: { min: -140, max: 140 }, speedY: { min: -60, max: 10 }, scale: { start: 0.45, end: 0 }, alpha: { start: 0.8, end: 0 }, lifespan: 450, gravityY: 200,
		})
		this.chipFx = this.add.particles('particle_brown').setDepth(4).createEmitter({
			on: false, speed: { min: 120, max: 320 }, angle: { min: 200, max: 340 }, scale: { start: 0.45, end: 0.2 }, rotate: { min: 0, max: 360 }, lifespan: 900, gravityY: 1300,
		})
		this.flameFx = this.add.particles('flame').setDepth(3).createEmitter({
			on: false, speedY: { min: 250, max: 420 }, speedX: { min: -40, max: 40 }, scale: { start: 0.5, end: 0 }, alpha: { start: 1, end: 0 }, lifespan: 380, frequency: 18, tint: [0xffe14a, 0xff9a2a, 0xff5a2a],
		})
		this.sparkFx = this.add.particles('star').setDepth(6).createEmitter({
			on: false, speed: { min: 80, max: 220 }, scale: { start: 1.6, end: 0 }, lifespan: 500, tint: [0xfff27a, 0xffffff, 0xffc94a],
		})

		// 화면 위 점수
		this.heightText = this.add.text(W / 2, 14, '0m', { ...TEXT, fontSize: 48 }).setScrollFactor(0).setOrigin(0.5, 0).setDepth(20)
		this.add.image(30, 44, 'coin_gold').setScrollFactor(0).setScale(0.6).setDepth(20)
		this.coinText = this.add.text(54, 26, '0', { ...TEXT, fontSize: 32 }).setScrollFactor(0).setDepth(20)

		// 시작 화면: 힘을 주면 시작
		this.physics.pause()
		const title = this.add.text(W / 2, H * 0.2, 'Bunny Jump', { ...TEXT, fontSize: 70, stroke: '#b5502a', strokeThickness: 11, color: '#fff3c4' })
		this.startUi = [
			title,
			this.add.text(W / 2, H * 0.31, '구름을 밟고 높이높이!', { ...TEXT, fontSize: 32 }),
			this.add.text(W / 2, H * 0.38, '약하게 ←   세게 →', { ...TEXT, fontSize: 28, color: '#fff3c4' }),
			this.add.text(W / 2, H * 0.5, '힘을 주면 시작', { ...TEXT, fontSize: 38 }),
		].map((t) => t.setOrigin(0.5).setScrollFactor(0).setDepth(30))
		this.tweens.add({ targets: title, y: title.y - 10, angle: { from: -2, to: 2 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' })
		this.tweens.add({ targets: this.startUi[3], scale: 1.12, alpha: 0.5, duration: 550, yoyo: true, repeat: -1, ease: 'Sine.inOut' })

		const begin = () => {
			if (this.started) return
			this.started = true
			this.startUi.forEach((t) => { this.tweens.killTweensOf(t); this.tweens.add({ targets: t, alpha: 0, y: t.y - 40, duration: 300, onComplete: () => t.destroy() }) })
			this.physics.resume()
			this.player.setVelocityY(JUMP)
			this.sound.play('jump', { volume: 0.35 })
		}
		this.input.keyboard.on('keydown', (e) => { if (e.key !== 'Escape') begin() })
		this.input.on('pointerdown', begin)

		// 미리 화면 위까지 발판을 채운다
		this.spawnAhead()
		this.drawSky()
	}

	groundY()
	{
		return this.scale.height - 70
	}

	heightOf(y)
	{
		return Math.max(0, Math.floor((this.groundY() - y) / 10))
	}

	makeTextures()
	{
		if (this.textures.exists('puff')) return
		const g = this.make.graphics({ x: 0, y: 0, add: false })
		g.fillStyle(0xffffff, 1)
		for (const [x, y, r] of [[55, 75, 38], [105, 55, 48], [160, 70, 40], [200, 88, 26], [30, 95, 24], [90, 95, 36], [145, 98, 34]]) g.fillCircle(x, y, r)
		g.generateTexture('puff', 230, 132)
		g.clear()
		g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4)
		g.generateTexture('star', 8, 8)
		g.destroy()
	}

	theme(h)
	{
		if (h < 150) return 'grass'
		if (h < 350) return 'sand'
		if (h < 600) return 'snow'
		return 'stone'
	}

	/** 발판 하나. 구름은 위쪽만 밟히고 살랑살랑 움직인다 */
	spawnPlatform(x, y, key, opts = {})
	{
		/** @type {Phaser.Physics.Arcade.Sprite} */
		const p = this.platforms.create(x, y, key)
		const cloud = key === 'cloud'
		const small = key.includes('_small')
		p.baseScale = cloud ? 0.46 : small ? 0.44 : 0.33
		p.setScale(p.baseScale)
		p.setDepth(1)
		p.kind = cloud ? 'cloud' : 'ground'
		p.breaks = !!opts.breaks
		p.attached = []
		p.dip = 0
		if (cloud) p.body.setSize(200, 40).setOffset(30, 22)
		else p.body.setSize(p.width * 0.92, 40).setOffset(p.width * 0.04, 2)
		p.vx = opts.vx || 0
		p.phase = Math.random() * 6
		p.body.setVelocityX(p.vx)
		return p
	}

	attach(p, obj, dx, dy)
	{
		obj.dx = dx
		obj.dy = dy
		p.attached.push(obj)
	}

	addDecor(p)
	{
		const th = p.texture.key.split('_')[1]
		const pool = th === 'sand' ? ['cactus', 'grass_brown1'] : th === 'snow' || th === 'stone' ? ['grass_brown1', 'mushroom_brown'] : ['grass1', 'grass2', 'mushroom_red']
		const key = Phaser.Utils.Array.GetRandom(pool)
		const dx = Phaser.Math.Between(-p.displayWidth * 0.32, p.displayWidth * 0.32)
		const img = this.add.image(p.x + dx, p.y - p.displayHeight * 0.38, key).setOrigin(0.5, 1).setScale(key === 'cactus' ? 0.32 : 0.42).setDepth(0)
		this.decor.push(img)
		this.attach(p, img, dx, img.y - p.y)
	}

	/** 화면 위쪽까지 한 줄씩 발판을 만든다 */
	spawnAhead()
	{
		const W = this.scale.width
		const top = this.cameras.main.scrollY - 160
		while (this.nextY > top)
		{
			const y = this.nextY
			const h = this.heightOf(y)
			const x = Phaser.Math.Between(70, W - 70)
			const th = this.theme(h)
			const small = h > 300 && Math.random() < Math.min(0.55, (h - 300) / 700)
			const cloud = Math.random() < 0.3
			const moving = h > 40 && Math.random() < Math.min(0.4, 0.1 + h / 1500)
			const vx = moving ? (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.Between(70, 70 + Math.min(130, h / 4)) : 0
			const p = this.spawnPlatform(x, y, cloud ? 'cloud' : `ground_${th}${small ? '_small' : ''}`, { vx })

			const r = Math.random()
			if (!cloud && h > 15 && r < 0.09) this.addSpring(p)
			else if (h > 80 && r < 0.115) this.addItem(p, 'powerup_jetpack', 0, -48)
			else if (r < 0.36) for (let i = 0; i < 3; i++) this.addItem(p, 'coin', 0, -52 - i * 44)
			else if (r < 0.42) this.addItem(p, 'carrot_gold', 0, -46)
			if (!cloud && !moving && Math.random() < 0.45) this.addDecor(p)

			const gap = Phaser.Math.Between(78, 100 + Math.min(55, h / 9))
			const mid = y - gap / 2
			if (h > 100 && Math.random() < 0.2)
			{
				// 밟으면 부서지는 발판 (튀어 오르지 않는다)
				const bx = Phaser.Math.Wrap(x + Phaser.Math.Between(150, W - 150), 60, W - 60)
				this.spawnPlatform(bx, mid, `ground_${th}${small ? '_small' : ''}_broken`, { breaks: true })
			}
			else if (h > 170 && Math.random() < Math.min(0.14, 0.04 + (h - 170) / 2500))
			{
				this.addEnemy(mid - 10, h)
			}
			this.nextY -= gap
		}
	}

	addSpring(p)
	{
		const dx = Phaser.Math.Between(-p.displayWidth * 0.28, p.displayWidth * 0.28)
		const s = this.springs.create(p.x + dx, p.y - p.displayHeight / 2 - 10, 'spring').setScale(0.36).setDepth(2)
		s.body.setSize(120, 50).setOffset(12, 14)
		this.attach(p, s, dx, s.y - p.y)
	}

	addItem(p, key, dx, dy)
	{
		const it = this.items.create(p.x + dx, p.y + dy, key === 'coin' ? 'gold_1' : key).setDepth(3)
		it.kind = key
		if (key === 'coin') { it.setScale(0.42); it.play({ key: 'spin', startFrame: Phaser.Math.Between(0, 5) }) }
		else if (key === 'carrot_gold') it.setScale(0.5)
		else it.setScale(0.55)
		this.attach(p, it, dx, dy)
	}

	addEnemy(y, h)
	{
		const W = this.scale.width
		const e = this.enemies.create(Phaser.Math.Between(60, W - 60), y, 'wingMan1').setScale(0.34).setDepth(4)
		e.play({ key: 'flap', startFrame: Phaser.Math.Between(0, 7) })
		e.body.setSize(140, 90)
		e.vx = (Math.random() < 0.5 ? -1 : 1) * Phaser.Math.Between(70, 90 + Math.min(80, h / 10))
		e.phase = Math.random() * 6
	}

	canLand(player, p)
	{
		if (this.dying || player.body.velocity.y <= 0) return false
		if (player.body.bottom > p.body.top + 18) return false
		if (p.breaks)
		{
			this.breakPlatform(p)
			return false
		}
		return true
	}

	land(player, p)
	{
		if (this.dying) return
		player.setVelocityY(JUMP)
		this.squash = 1
		this.sound.play('jump', { volume: 0.3, rate: Phaser.Math.FloatBetween(0.95, 1.1) })
		this.dustFx.explode(7, player.x, p.body.top)
		// 발판도 살짝 눌린다
		p.dip = 1
	}

	breakPlatform(p)
	{
		if (p.broke) return
		p.broke = true
		sfx.crack()
		this.chipFx.explode(10, p.x, p.y)
		this.platforms.remove(p)
		this.physics.world.disable(p)
		this.tweens.add({ targets: p, y: p.y + 260, angle: Phaser.Math.Between(-40, 40), alpha: 0, duration: 800, ease: 'Quad.in', onComplete: () => p.destroy() })
	}

	hitSpring(player, s)
	{
		if (this.dying || player.body.velocity.y <= 0 || player.body.bottom > s.body.top + 22) return
		player.setVelocityY(SPRING_JUMP)
		this.squash = 1
		sfx.spring()
		s.setTexture('spring_out')
		this.time.delayedCall(260, () => { if (s.active) s.setTexture('spring') })
		this.cameras.main.shake(120, 0.004)
	}

	collect(player, it)
	{
		if (this.dying || !it.active) return
		const x = it.x, y = it.y
		if (it.kind === 'powerup_jetpack')
		{
			this.jetUntil = this.time.now + JET_MS
			sfx.power()
			sfx.jet()
			this.flameFx.start()
			this.jetImg.setVisible(true)
		}
		else
		{
			const gold = it.kind === 'carrot_gold'
			this.coins += gold ? 5 : 1
			this.coinPoints += gold ? 50 : 10
			this.coinText.text = `${this.coins}`
			this.tweens.add({ targets: this.coinText, scale: { from: 1.4, to: 1 }, duration: 250 })
			sfx.coin()
			this.sparkFx.explode(gold ? 14 : 6, x, y)
			const pop = this.add.text(x, y - 16, gold ? '+50' : '+10', { ...TEXT, fontSize: gold ? 30 : 24, color: gold ? '#ffe066' : '#ffffff', strokeThickness: 5 }).setOrigin(0.5).setDepth(8)
			this.tweens.add({ targets: pop, y: y - 70, alpha: 0, duration: 700, ease: 'Quad.out', onComplete: () => pop.destroy() })
		}
		it.destroy()
	}

	hitEnemy(player, e)
	{
		if (this.dying || e.dead) return
		const jet = this.time.now < this.jetUntil
		if (jet || (player.body.velocity.y > 0 && player.body.bottom < e.body.center.y + 6))
		{
			// 위에서 밟거나 제트팩으로 부딪치면 적이 떨어진다
			e.dead = true
			this.enemies.remove(e)
			this.physics.world.disable(e)
			e.anims.stop()
			sfx.stomp()
			this.sparkFx.explode(10, e.x, e.y)
			this.tweens.add({ targets: e, y: e.y + 500, angle: 300, alpha: 0.3, duration: 1000, ease: 'Quad.in', onComplete: () => e.destroy() })
			if (!jet) { player.setVelocityY(JUMP * 1.15); this.squash = 1 }
			this.coinPoints += 30
			const pop = this.add.text(e.x, e.y - 20, '+30', { ...TEXT, fontSize: 26, strokeThickness: 5 }).setOrigin(0.5).setDepth(8)
			this.tweens.add({ targets: pop, y: pop.y - 60, alpha: 0, duration: 700, onComplete: () => pop.destroy() })
			return
		}
		this.die()
	}

	die()
	{
		if (this.dying) return
		this.dying = true
		sfx.hurt()
		this.flameFx.stop()
		this.jetImg.setVisible(false)
		this.player.body.checkCollision.down = false
		this.player.setVelocity(0, -520)
		this.cameras.main.shake(260, 0.012)
		this.cameras.main.flash(160, 255, 120, 120)
	}

	update(t, dt)
	{
		const W = this.scale.width, H = this.scale.height
		const cam = this.cameras.main
		const body = this.player.body

		// 카메라: 토끼가 화면 위쪽 42% 를 넘으면 부드럽게 따라 올라간다. 내려가지는 않는다.
		if (this.started && !this.dying)
		{
			const target = this.player.y - H * 0.42
			if (target < cam.scrollY) cam.scrollY += (target - cam.scrollY) * (1 - Math.exp(-dt / 70))
		}

		this.spawnAhead()
		this.cleanup(cam.scrollY + H + 140)

		// 움직이는 발판·구름, 붙은 것들
		const sec = t / 1000
		this.platforms.children.iterate((p) => {
			if (!p) return
			if (p.vx)
			{
				const half = p.displayWidth / 2
				if (p.x < half && p.body.velocity.x < 0) p.body.setVelocityX(Math.abs(p.vx))
				else if (p.x > W - half && p.body.velocity.x > 0) p.body.setVelocityX(-Math.abs(p.vx))
			}
			p.body.setVelocityY(p.kind === 'cloud' ? Math.cos(sec * 1.8 + p.phase) * 22 : 0)
			if (p.dip) p.dip = Math.max(0, p.dip - dt / 180)
			p.scaleY = p.baseScale * (1 - 0.12 * Math.sin(p.dip * Math.PI))
			for (const o of p.attached)
			{
				if (!o.active) continue
				if (o.body) o.body.reset(p.x + o.dx, p.y + o.dy)
				else { o.x = p.x + o.dx; o.y = p.y + o.dy }
			}
		})
		this.enemies.children.iterate((e) => {
			if (!e) return
			if (e.x < 40 && e.vx < 0) e.vx = Math.abs(e.vx)
			else if (e.x > W - 40 && e.vx > 0) e.vx = -Math.abs(e.vx)
			e.body.setVelocity(e.vx, Math.cos(sec * 3 + e.phase) * 40)
			e.setFlipX(e.vx > 0)
		})

		// 좌우: 부드럽게 가속
		if (this.started && !this.dying)
		{
			const want = this.cursors.left.isDown ? -MOVE : this.cursors.right.isDown ? MOVE : 0
			body.velocity.x += (want - body.velocity.x) * (1 - Math.exp(-dt / 85))
			if (want) this.facing = want < 0 ? -1 : 1
		}
		this.horizontalWrap(this.player)

		// 제트팩
		const jet = this.time.now < this.jetUntil
		if (jet && !this.dying)
		{
			body.setVelocityY(JET_SPEED)
		}
		else if (this.jetImg.visible && !this.dying)
		{
			this.flameFx.stop()
			const j = this.add.image(this.jetImg.x, this.jetImg.y, 'jetpack').setScale(0.38).setDepth(4)
			this.jetImg.setVisible(false)
			this.tweens.add({ targets: j, y: j.y + 600, angle: 400, duration: 1300, ease: 'Quad.in', onComplete: () => j.destroy() })
		}

		this.drawBunny(dt, jet)
		this.drawSky(t, dt)

		// 높이 점수
		if (!this.dying)
		{
			const h = this.heightOf(this.player.y)
			if (h > this.maxHeight)
			{
				this.maxHeight = h
				this.heightText.text = `${h}m`
			}
		}

		if (!this.over && this.player.y > cam.scrollY + H + 80)
		{
			this.gameOver()
		}
	}

	drawBunny(dt, jet)
	{
		const b = this.bunny, body = this.player.body
		const vy = body.velocity.y
		let tex = 'bunny1_jump'
		if (!this.started) tex = 'bunny1_ready'
		else if (this.dying) tex = 'bunny1_hurt'
		else if (vy > 150) tex = 'bunny1_stand'
		if (b.texture.key !== tex) b.setTexture(tex)

		// 착지하면 찌그러졌다가 늘어나며 튀어 오른다
		this.squash = Math.max(0, this.squash - dt / 260)
		const sq = Math.sin(this.squash * Math.PI) * (this.squash > 0.6 ? -0.28 : 0.18)
		const stretch = Phaser.Math.Clamp(-vy / 6000, -0.06, 0.12)
		const sy = 1 + stretch - sq, sx = 1 - stretch * 0.7 + sq * 0.8
		b.setScale(BUNNY * sx, BUNNY * sy)
		b.setFlipX(this.facing === -1)
		if (this.dying) b.setAngle(b.angle + dt * 0.5)
		else b.setAngle(Phaser.Math.Linear(b.angle, Phaser.Math.Clamp(body.velocity.x / 22, -14, 14), 0.2))
		const bob = this.started ? 0 : Math.sin(this.time.now / 260) * 6
		b.setPosition(this.player.x, this.player.y + bob)

		if (this.jetImg.visible)
		{
			const side = this.facing === -1 ? 1 : -1
			this.jetImg.setPosition(this.player.x + side * 18, this.player.y + 4).setFlipX(this.facing === -1).setAngle(b.angle)
			this.flameFx.setPosition(this.jetImg.x, this.jetImg.y + 34)
		}
		b.setDepth(jet ? 6 : 5)
	}

	drawSky(t = 0, dt = 16)
	{
		const W = this.scale.width, H = this.scale.height
		const h = this.heightOf(this.cameras.main.scrollY + H / 2)
		if (h !== this.lastSky)
		{
			this.lastSky = h
			const [top, bottom] = skyAt(h)
			this.sky.clear()
			this.sky.fillGradientStyle(top, top, bottom, bottom, 1)
			this.sky.fillRect(0, 0, W, H)
			// 게임 양옆 빈 곳도 같은 하늘색으로 (조금 어둡게)
			const css = (c) => `#${mix(c, 0x000000, 0.12).toString(16).padStart(6, '0')}`
			document.body.style.background = `linear-gradient(180deg, ${css(top)} 0%, ${css(bottom)} 100%)`
		}
		const night = Phaser.Math.Clamp((h - 380) / 350, 0, 1)
		for (const s of this.stars) s.setAlpha(night * (0.45 + 0.55 * Math.sin(t / 500 + s.tw)))
		const scrollY = this.cameras.main.scrollY
		const tint = mix(0xffffff, 0x8f8fd0, night)
		for (const p of this.puffs)
		{
			p.x += p.vx * dt / 1000
			if (p.x < -140) p.x = W + 140
			if (p.x > W + 140) p.x = -140
			// 화면 아래로 지나간 구름은 위로 돌린다
			if (p.y - scrollY * 0.35 > H + 90) { p.y -= H + 220; p.x = Phaser.Math.Between(0, W) }
			p.setTint(tint)
		}
	}

	cleanup(limit)
	{
		for (const g of [this.platforms, this.springs, this.items, this.enemies])
		{
			for (const o of g.getChildren().slice())
			{
				if (o.y > limit) o.destroy()
			}
		}
		this.decor = this.decor.filter((d) => { if (d.y > limit) { d.destroy(); return false } return true })
	}

	gameOver()
	{
		this.over = true
		this.flameFx.stop()
		if (this.maxHeight > this.bestHeight)
		{
			try { localStorage.setItem('bunnyBestHeight', String(this.maxHeight)) } catch (e) { /* ignore */ }
		}
		this.time.delayedCall(450, () => {
			this.scene.start('game-over', { height: this.maxHeight, coins: this.coins, score: this.maxHeight + this.coinPoints, sky: skyAt(this.maxHeight) })
		})
	}

	/**
	 * @param {Phaser.GameObjects.Sprite} sprite
	 */
	horizontalWrap(sprite)
	{
		const halfWidth = sprite.displayWidth * 0.5
		const gameWidth = this.scale.width
		if (sprite.x < -halfWidth)
		{
			sprite.x = gameWidth + halfWidth
		}
		else if (sprite.x > gameWidth + halfWidth)
		{
			sprite.x = -halfWidth
		}
	}
}
