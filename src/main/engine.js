'use strict';

// 구간 RMS → 역치(히스테리시스) → 키 누름/뗌. 시간·키 보내기를 밖에서 받는 순수 클래스라 장치·Windows 없이 테스트한다.
//   켜짐: rms >= threshold,  꺼짐: rms < threshold × releaseRatio  (그 사이는 지금 상태 유지)
//   hold: 켜질 때 누르고 꺼질 때 뗀다.
//   tap : 켜질 때 tapMs 동안 눌렀다 뗀다. 꺼진 뒤 cooldownMs 가 지나야 다음 탭이 나간다.
// 안전: 가동 정지·시험 모드 전환·신호 끊김·설정 변경 때는 눌려 있던 키를 반드시 뗀다.

class KeyEngine {
  /** @param {{ send: (action: 'down'|'up', code: string) => void, onChange?: (state: object) => void }} io */
  constructor({ send, onChange } = {}) {
    this.send = send || (() => {});
    this.onChange = onChange || (() => {});
    this.cfg = { threshold: 10, releaseRatio: 0.7, mode: 'hold', tapMs: 30, cooldownMs: 120, code: 'Space' };
    this.enabled = false;
    this.test = false;
    this.active = false; // 역치 위 (미리보기용으로 정지 중에도 계산한다)
    this.pressed = false; // 키가 눌린 것으로 본다 (시험 모드에서는 실제로 보내지 않는다)
    this._real = null; // 실제로 눌린 키 코드 (보낸 것만)
    this._pressedCode = null;
    this._tapUntil = 0;
    this._lastTapEnd = -Infinity;
  }

  configure(next) {
    const c = { ...this.cfg, ...next };
    const changedKey = c.code !== this.cfg.code || c.mode !== this.cfg.mode;
    this.cfg = c;
    if (changedKey && this.pressed) this._release(); // 누른 채로 바뀌면 옛 키를 뗀다
    this._emit();
  }

  setEnabled(on, t = 0) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this._release();
    else if (this.active && this.cfg.mode === 'hold') this._press(t); // 이미 힘이 들어가 있는 채로 켜지면 바로 누른다
    this._emit();
  }

  setTest(on) {
    on = !!on;
    if (on === this.test) return;
    // 실제 키가 눌린 채로 시험 모드로 바뀌면 먼저 뗀다
    if (this._real !== null) this._sendUp();
    this.test = on;
    this._emit();
  }

  /** 구간마다 호출 */
  update(rms, t) {
    const on = this.cfg.threshold;
    const off = this.cfg.threshold * this.cfg.releaseRatio;
    let active = this.active;
    if (!active && rms >= on) active = true;
    else if (active && rms < off) active = false;
    if (active === this.active) return;
    this.active = active;
    if (this.enabled) {
      if (active) {
        if (this.cfg.mode === 'hold') this._press(t);
        else if (t - this._lastTapEnd >= this.cfg.cooldownMs && !this.pressed) {
          this._press(t);
          this._tapUntil = t + this.cfg.tapMs;
        }
      } else if (this.cfg.mode === 'hold') {
        this._release(t);
      }
    }
    this._emit();
  }

  /** 짧은 간격(10~20 ms)으로 호출: 탭을 뗄 시간이 되면 뗀다 */
  tick(t) {
    if (this.pressed && this.cfg.mode === 'tap' && t >= this._tapUntil) {
      this._release(t);
      this._emit();
    }
  }

  /** 신호가 끊겼다 */
  signalLost() {
    const was = this.active || this.pressed;
    this.active = false;
    this._release();
    if (was) this._emit();
  }

  releaseAll() {
    this._release();
    this._emit();
  }

  get state() {
    return { enabled: this.enabled, test: this.test, active: this.active, pressed: this.pressed };
  }

  _press() {
    if (this.pressed) return;
    this.pressed = true;
    this._pressedCode = this.cfg.code;
    if (!this.test) {
      this._real = this._pressedCode;
      this.send('down', this._real);
    }
  }

  _release(t) {
    if (!this.pressed && this._real === null) return;
    this._sendUp();
    this.pressed = false;
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
