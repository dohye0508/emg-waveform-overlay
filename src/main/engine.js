'use strict';

// 구간 RMS → 힘 단계 → 키 누름/뗌. 시간·키 보내기를 밖에서 받는 순수 클래스라 장치·Windows 없이 테스트한다.
//
// 단계(level): 0 = 쉼, 1 = 약하게(threshold 이상), 2 = 세게(threshold2 이상, 2단계 모드만).
//   올라갈 때는 역치 이상, 내려갈 때는 역치 × releaseRatio 미만이어야 바뀐다 (그 사이는 지금 단계 유지).
// 1단계 모드: 단계 1 이 되면 code 를 누른다.
// 2단계 모드: 약하게 = code, 세게 = code2.
//   세게 줄 때도 힘이 약하게 구간을 지나가므로, 약하게 키는 decideMs 동안 기다렸다가 세게까지 안 올라가면 누른다.
//   세게에서 힘을 빼며 약하게 구간으로 내려올 때는 약하게 키를 누르지 않는다 (쉼까지 내려가야 다시 판정).
// hold: 그 단계에 있는 동안 키를 누르고 있다.  tap: 한 번 tapMs 동안 눌렀다 떼고, 쉼으로 돌아와야(그리고 cooldownMs 뒤) 다음 탭.
// 안전: 가동 정지·시험 모드 전환·신호 끊김·키 변경 때는 눌려 있던 키를 반드시 뗀다.

class KeyEngine {
  /** @param {{ send: (action: 'down'|'up', code: string) => void, onChange?: (state: object) => void }} io */
  constructor({ send, onChange } = {}) {
    this.send = send || (() => {});
    this.onChange = onChange || (() => {});
    this.cfg = { threshold: 10, threshold2: 20, releaseRatio: 0.7, levels: 1, mode: 'hold', tapMs: 30, cooldownMs: 120, decideMs: 150, code: 'Space', code2: 'ArrowRight' };
    this.enabled = false;
    this.test = false;
    this.level = 0; // 미리보기용으로 정지 중에도 계산한다
    this.pressed = false; // 키가 눌린 것으로 본다 (시험 모드에서는 실제로 보내지 않는다)
    this.pressedLevel = 0;
    this._pressedCode = null;
    this._real = null; // 실제로 눌린 키 코드 (보낸 것만)
    this._pending = null; // 약하게 판정 대기 { since }
    this._latched = false; // hold: 세게에서 내려오는 중
    this._armed = true; // tap: 쉼으로 돌아와야 다음 탭
    this._tapUntil = 0;
    this._lastTapEnd = -Infinity;
  }

  get active() {
    return this.level > 0;
  }

  configure(next) {
    const c = { ...this.cfg, ...next };
    const changedKey = c.code !== this.cfg.code || c.code2 !== this.cfg.code2 || c.mode !== this.cfg.mode || c.levels !== this.cfg.levels;
    this.cfg = c;
    if (changedKey) {
      this._release(); // 누른 채로 바뀌면 옛 키를 뗀다
      this._pending = null;
      this._latched = false;
    }
    this._emit();
  }

  setEnabled(on, t = 0) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this._pending = null;
    this._latched = false;
    if (!on) this._release();
    else if (this.level > 0 && this.cfg.mode === 'hold') this._enter(this.level, 0, t); // 이미 힘이 들어가 있는 채로 켜지면 바로 판정
    this._emit();
  }

  setTest(on) {
    on = !!on;
    if (on === this.test) return;
    if (this._real !== null) this._sendUp(); // 실제 키가 눌린 채로 시험 모드로 바뀌면 먼저 뗀다
    this.test = on;
    this._emit();
  }

  /** 구간마다 호출 */
  update(rms, t) {
    const c = this.cfg;
    const two = c.levels === 2;
    let L = this.level;
    if (two && L < 2 && rms >= c.threshold2) L = 2;
    else if (L === 2 && rms < c.threshold2 * c.releaseRatio) L = rms >= c.threshold * c.releaseRatio ? 1 : 0;
    if (L === 0 && rms >= c.threshold) L = 1;
    else if (L === 1 && rms < c.threshold * c.releaseRatio) L = 0;
    if (L === this.level) return;
    const prev = this.level;
    this.level = L;
    if (this.enabled) this._enter(L, prev, t);
    this._emit();
  }

  /** 짧은 간격(10~20 ms)으로 호출: 약하게 판정, 탭 떼기 */
  tick(t) {
    const c = this.cfg;
    let changed = false;
    if (this.enabled && this._pending && t - this._pending.since >= c.decideMs) {
      this._pending = null;
      if (c.mode === 'hold') {
        if (this.level === 1 && !this._latched) { this._press(1); changed = true; }
      } else {
        this._tap(1, t);
        changed = true;
      }
    }
    if (this.pressed && c.mode === 'tap' && t >= this._tapUntil) {
      this._release(t);
      changed = true;
    }
    if (changed) this._emit();
  }

  /** 신호가 끊겼다 */
  signalLost() {
    const was = this.level > 0 || this.pressed;
    this.level = 0;
    this._pending = null;
    this._latched = false;
    this._armed = true;
    this._release();
    if (was) this._emit();
  }

  releaseAll() {
    this._pending = null;
    this._release();
    this._emit();
  }

  get state() {
    return { enabled: this.enabled, test: this.test, active: this.level > 0, level: this.level, pressed: this.pressed, pressedLevel: this.pressedLevel };
  }

  /** 단계가 prev → L 로 바뀌었다 (가동 중) */
  _enter(L, prev, t) {
    const c = this.cfg;
    const two = c.levels === 2;
    if (c.mode === 'hold') {
      if (L === 0) {
        this._pending = null;
        this._latched = false;
        this._release();
      } else if (L === 2) {
        this._pending = null;
        this._latched = false;
        this._press(2);
      } else if (prev === 2) {
        // 세게에서 힘을 빼는 중: 약하게 키는 누르지 않는다
        this._release();
        this._latched = true;
      } else if (!this._latched) {
        if (two && c.decideMs > 0) this._pending = { since: t };
        else this._press(1);
      }
      return;
    }
    // tap
    if (L === 0) {
      // 판정 시간 안에 짧게 힘을 줬다 뺐으면 약하게로 친다
      if (this._pending) { this._pending = null; this._tap(1, t); }
      this._armed = true;
      return;
    }
    if (L === 2 && this._pending) {
      this._pending = null;
      this._tap(2, t);
      return;
    }
    if (prev === 0 && this._armed && !this.pressed && t - this._lastTapEnd >= c.cooldownMs) {
      if (L === 2 || !two || c.decideMs <= 0) this._tap(L, t);
      else this._pending = { since: t };
    }
  }

  _tap(L, t) {
    this._armed = false;
    this._press(L);
    this._tapUntil = t + this.cfg.tapMs;
  }

  _press(L) {
    const code = L === 2 && this.cfg.levels === 2 ? this.cfg.code2 : this.cfg.code;
    if (this.pressed && this._pressedCode === code) return;
    if (this.pressed) this._release();
    this.pressed = true;
    this.pressedLevel = L;
    this._pressedCode = code;
    if (!this.test) {
      this._real = code;
      this.send('down', code);
    }
  }

  _release(t) {
    if (!this.pressed && this._real === null) return;
    this._sendUp();
    this.pressed = false;
    this.pressedLevel = 0;
    this._pressedCode = null;
    if (t != null) this._lastTapEnd = t;
  }

  _sendUp() {
    if (this._real !== null) {
      const code = this._real;
      this._real = null;
      this.send('up', code);
    }
  }

  _emit() {
    this.onChange(this.state);
  }
}

module.exports = { KeyEngine };
