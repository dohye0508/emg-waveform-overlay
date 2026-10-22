// EMG Overlay: 효과음은 Web Audio 로 바로 만든다 (파일 없이). 점프 소리만 템플릿의 phaseJump1.wav.
let ctx = null

function ac()
{
	if (!ctx) ctx = new AudioContext()
	if (ctx.state === 'suspended') ctx.resume()
	return ctx
}

function tone(f1, f2, dur, type = 'square', vol = 0.06, delay = 0)
{
	const a = ac(), t = a.currentTime + delay
	const o = a.createOscillator(), g = a.createGain()
	o.type = type
	o.frequency.setValueAtTime(f1, t)
	o.frequency.exponentialRampToValueAtTime(f2, t + dur)
	g.gain.setValueAtTime(vol, t)
	g.gain.exponentialRampToValueAtTime(0.001, t + dur)
	o.connect(g).connect(a.destination)
	o.start(t)
	o.stop(t + dur + 0.02)
}

function noise(dur, vol, freq = 900)
{
	const a = ac(), t = a.currentTime
	const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate)
	const d = buf.getChannelData(0)
	for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
	const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain()
	s.buffer = buf
	f.type = 'bandpass'
	f.frequency.value = freq
	g.gain.setValueAtTime(vol, t)
	g.gain.exponentialRampToValueAtTime(0.001, t + dur)
	s.connect(f).connect(g).connect(a.destination)
	s.start(t)
}

export const sfx = {
	coin() { tone(988, 988, 0.07, 'square', 0.05); tone(1319, 1319, 0.2, 'square', 0.05, 0.07) },
	spring() { tone(260, 1300, 0.32, 'triangle', 0.16) },
	crack() { noise(0.3, 0.25, 500) },
	stomp() { tone(520, 110, 0.2, 'square', 0.09) },
	power() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.1, 'square', 0.05, i * 0.07)) },
	jet() { noise(0.5, 0.12, 300) },
	hurt() { tone(700, 80, 0.7, 'sawtooth', 0.07) },
}
