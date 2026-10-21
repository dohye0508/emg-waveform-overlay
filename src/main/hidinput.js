'use strict';

// SpikerBox Pro(USB HID) 입력. 2초마다 장치를 찾아 열고, 끊기면 다시 찾고, 신호가 멈추면 start 를 다시 보낸다.
// 받은 프레임은 두 가지로 내보낸다.
//   'frames' (frames, rate)  원시 프레임 전체 (자동 설정이 모든 채널로 분석한다)
//   'emg'    (values, rate)  선택한 채널을 필터에 통과시킨 샘플 (켠 직후 1초 안정화 구간은 내보내지 않는다)
// hid 모듈은 밖에서 받을 수 있어(hidApi) 가짜 장치로 테스트한다.

const { EventEmitter } = require('events');
const hid = require('./hid');
const { EmgFilter } = require('./emg');

const LIST_MS = 2000;
const TICK_MS = 500;
const STALL_MS = 2000; // 이만큼 프레임이 없으면 start 를 다시 보낸다
const RESTART_WAIT_MS = 3000; // 그 뒤로도 없으면 닫고 다시 연다
const SETTLE_MS = 1000;
const ALIVE_MS = 1000; // 1초 안에 프레임이 왔으면 연결됨
const BACKOFF_MS = [2000, 4000, 8000, 10000];

class HidInput extends EventEmitter {
  constructor({ getSettings, hidApi, now } = {}) {
    super();
    this.getSettings = getSettings || (() => ({ signal: {} }));
    this.hid = hidApi || hid;
    this.now = now || Date.now;
    this.timer = null;
    this.dev = null;
    this.info = null;
    this.decoder = new hid.HidDecoder();
    this.filter = null;
    this.filterKey = '';
    this.settleUntil = 0;
    this.msf = null;
    this.hwt = null;
    this.openedAt = 0;
    this.lastFrameAt = 0;
    this.restartAt = 0;
    this.lastListAt = -Infinity;
    this.fails = 0;
    this.nextTryAt = 0;
    this.openError = null;
    this.fps = 0;
    this._fpsStart = 0;
    this._fpsCount = 0;
    this.total = 0;
  }

  start() {
    this.tick(this.now());
    this.timer = setInterval(() => this.tick(this.now()), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.close();
  }

  /** 포트 다시 연결 */
  reconnect() {
    this.close();
    this.nextTryAt = 0;
    this.lastListAt = -Infinity;
  }

  tick(t) {
    if (this.dev) {
      this.checkStall(t);
      if (this.dev && t - this.lastListAt >= LIST_MS) this.checkPresent(t);
      return;
    }
    if (t - this.lastListAt >= LIST_MS && t >= this.nextTryAt) this.tryOpen(t);
  }

  deviceList() {
    const list = this.hid.listDevices();
    return Array.isArray(list) ? list : null;
  }

  checkPresent(t) {
    this.lastListAt = t;
    const list = this.deviceList();
    if (list && !list.some((d) => d.path === this.info.path)) {
      // 다른 USB 포트에 다시 꽂아 경로가 바뀌었다
      this.close();
    }
  }

  tryOpen(t) {
    this.lastListAt = t;
    const list = this.deviceList();
    if (!list || !list.length) return;
    this.open(list[0], t);
  }

  open(info, t) {
    this.decoder = new hid.HidDecoder();
    this.filter = null;
    this.filterKey = '';
    this.msf = null;
    this.hwt = null;
    this.fps = 0;
    this._fpsStart = 0;
    this._fpsCount = 0;
    this.openedAt = t;
    this.lastFrameAt = 0;
    this.restartAt = 0;
    this.info = info;
    let gotFrames = false;
    try {
      this.dev = this.hid.openDevice(info, {
        onData: (buf) => {
          gotFrames = true;
          this.onPayload(buf, this.now());
        },
        onBadReport: () => this.decoder.badReport(),
        onClose: () => {
          // 프레임을 한 번도 못 받고 닫혔으면 열기 실패로 친다
          if (!gotFrames) this.failed(null);
          this.close();
        },
      });
    } catch (err) {
      this.dev = null;
      this.failed(err);
      return;
    }
    this.emit('device', { path: info.path, name: info.product || 'SpikerBox' });
  }

  failed(err) {
    const wait = BACKOFF_MS[Math.min(this.fails, BACKOFF_MS.length - 1)];
    this.fails++;
    this.nextTryAt = this.now() + wait;
    // 다른 프로그램(Spike Recorder, 스코어보드 등)이 쓰는 중이거나 권한 없음
    this.openError = err ? err.message : '장치가 바로 닫힘';
  }

  checkStall(t) {
    if (t - Math.max(this.lastFrameAt, this.openedAt) < STALL_MS) return;
    if (!this.restartAt) {
      this.restartAt = t;
      if (this.dev && this.dev.restart) this.dev.restart();
    } else if (t - this.restartAt >= RESTART_WAIT_MS) {
      this.close();
    }
  }

  close() {
    const dev = this.dev;
    this.dev = null;
    this.info = null;
    this.fps = 0;
    if (dev) {
      try { dev.close(); } catch (_) { /* ignore */ }
    }
    this.emit('closed');
  }

  /** 장치가 보낸 payload 한 덩어리 */
  onPayload(buf, t) {
    const r = this.decoder.push(buf);
    for (const m of r.messages) {
      if (m.type === 'MSF') this.msf = Number(m.value) || this.msf;
      if (m.type === 'HWT') this.hwt = m.value;
    }
    if (!r.frames.length) return;
    this.lastFrameAt = t;
    this.restartAt = 0;
    if (this.fails) {
      this.fails = 0;
      this.openError = null;
    }
    this.total += r.frames.length;
    if (!this._fpsStart) this._fpsStart = t;
    this._fpsCount += r.frames.length;
    if (t - this._fpsStart >= 1000) {
      this.fps = Math.round((this._fpsCount * 1000) / (t - this._fpsStart));
      this._fpsStart = t;
      this._fpsCount = 0;
    }
    const channels = r.frames[0].length;
    const rate = this.msf || hid.defaultRate(channels);
    this.emit('frames', r.frames, rate);

    const sg = this.getSettings().signal || {};
    const want = (sg.channel || 1) - 1;
    const idx = want < channels ? want : 0;
    const opts = { mainsHz: sg.mainsHz, notch: sg.notch, highpassHz: sg.highpassHz };
    // 채널·필터 설정·샘플레이트가 바뀌면 필터를 새로 만들고 1초 동안 안정화한다
    const key = [idx, rate, opts.mainsHz, opts.notch, opts.highpassHz].join('|');
    if (key !== this.filterKey) {
      this.filter = new EmgFilter(rate, opts);
      this.filterKey = key;
      this.settleUntil = t + SETTLE_MS;
    }
    const out = this.filter.process(r.frames.map((f) => f[idx]));
    if (t >= this.settleUntil) this.emit('emg', out, rate);
  }

  status(t) {
    const connected = !!this.dev && t - this.lastFrameAt < ALIVE_MS;
    return {
      present: !!this.dev,
      connected,
      fps: connected ? this.fps : 0,
      channels: this.dev ? this.decoder.channels : null,
      name: this.hwt === 'MUSCLESB' ? 'Muscle SpikerBox Pro' : this.hwt || (this.info && this.info.product) || null,
      openError: this.dev ? null : this.openError,
    };
  }
}

module.exports = { HidInput };
