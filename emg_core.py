"""SpikerBox Pro (USB HID 2E73:0001) 값 읽기: 디코더, 필터, 파형 압축, 읽기 스레드.

emg.py(실기기에서 값이 정확히 읽히는 것을 확인한 스크립트)와 같은 규칙을 따른다.
화면(tkinter)을 모르는 순수 모듈이라 장치 없이 테스트할 수 있다.
"""
from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Callable, Optional

VID, PID = 0x2E73, 0x0001
BEGIN = bytes([255, 255, 1, 1, 128, 255])
END = bytes([255, 255, 1, 1, 129, 255])
ADC_MAX = 1023  # 10비트
ADC_CENTER = 512
MAX_MESSAGE = 1024
STALL_SECONDS = 3.0


def command(text: str) -> bytes:
    """HID 명령 보고서: [0x3F, 62] + ASCII 를 62바이트로 채운 64바이트"""
    payload = text.encode("ascii")
    if len(payload) > 62:
        raise ValueError("HID command exceeds 62 bytes")
    return bytes([0x3F, 62]) + payload.ljust(62, b"\0")


class Decoder:
    """보고서 [0x3F, 길이, 데이터…] → ADC 프레임. 제어 메시지는 샘플로 보지 않는다."""

    def __init__(self) -> None:
        self.pending = bytearray()
        self.message: Optional[bytearray] = None
        self.frame = bytearray()
        self.channel_count = 2
        self.bad_frames = 0
        self.bad_reports = 0

    def _sample_byte(self, value: int, frames: list) -> None:
        if value & 0x80:
            if self.frame:
                if len(self.frame) == 2 * self.channel_count:
                    values = tuple(((self.frame[i] & 127) << 7) | self.frame[i + 1]
                                   for i in range(0, len(self.frame), 2))
                    if all(v <= ADC_MAX for v in values):
                        frames.append(values)
                    else:
                        self.bad_frames += 1
                else:
                    self.bad_frames += 1
            self.frame = bytearray([value])
        elif self.frame:
            self.frame.append(value)
            if len(self.frame) > 8:
                self.bad_frames += 1
                self.frame.clear()

    def feed(self, report: bytes):
        """보고서 1개 → (frames, messages). 형식이 깨진 보고서는 진행 중이던 프레임·메시지를 버린다."""
        frames, messages = [], []
        if len(report) >= 3 and report[0] == 0 and report[1] == 0x3F:
            report = report[1:]  # 일부 백엔드는 앞에 0 을 붙여 준다
        if len(report) < 2 or report[1] > min(62, len(report) - 2):
            self.bad_reports += 1
            self.frame.clear()
            self.pending.clear()
            self.message = None
            return frames, messages
        for value in report[2:2 + report[1]]:
            self.pending.append(value)
            marker = END if self.message is not None else BEGIN
            while self.pending and not marker.startswith(self.pending):
                first = self.pending.pop(0)
                if self.message is None:
                    self._sample_byte(first, frames)
                else:
                    self.message.append(first)
                    if len(self.message) > MAX_MESSAGE:
                        # 깨진 제어 메시지: 그 메시지만 버리고 계속
                        self.bad_reports += 1
                        self.message = None
                        self.pending.clear()
                        break
            if self.pending == marker:
                self.pending.clear()
                if self.message is None:
                    self.message = bytearray()
                else:
                    messages.append(bytes(self.message))
                    if b"BRD:" in self.message:
                        # 확장보드는 프레임 폭을 바꾼다. 다음 시작 표시부터 새 폭으로 읽는다.
                        self.frame.clear()
                        for field in self.message.split(b";"):
                            if field.startswith(b"BRD:"):
                                board = field[4:5]
                                self.channel_count = 4 if board == b"1" else 3 if board in (b"4", b"5") else 2
                    self.message = None
        return frames, messages


def coefficients(kind: str, fs: float, frequency: float, q: float):
    """emg.py coefficients(): 노치/저역/고역 바이쿼드 계수 (b0, b1, b2, a1, a2)"""
    if not 0 < frequency < fs / 2 or q <= 0:
        raise ValueError("Filter frequency must be below Nyquist and Q must be positive")
    omega = 2 * math.pi * frequency / fs
    cosine = math.cos(omega)
    alpha = math.sin(omega) / (2 * q)
    a0 = 1 + alpha
    if kind == "lowpass":
        b0, b1, b2 = (1 - cosine) / 2, 1 - cosine, (1 - cosine) / 2
    elif kind == "highpass":
        b0, b1, b2 = (1 + cosine) / 2, -(1 + cosine), (1 + cosine) / 2
    elif kind == "notch":
        b0, b1, b2 = 1, -2 * cosine, 1
    else:
        raise ValueError("Unknown filter type")
    return b0 / a0, b1 / a0, b2 / a0, -2 * cosine / a0, (1 - alpha) / a0


class Biquad:
    def __init__(self, coeffs) -> None:
        self.b0, self.b1, self.b2, self.a1, self.a2 = coeffs
        self.z1 = self.z2 = 0.0

    def process(self, value: float) -> float:
        result = self.b0 * value + self.z1
        self.z1 = self.b1 * value - self.a1 * result + self.z2
        self.z2 = self.b2 * value - self.a2 * result
        return result


class EmgFilter:
    """한 채널: raw-512 → (노치) → 저역 2500 Hz(Q .5) → 고역 1 Hz(Q .5). emg.py 와 같다."""

    def __init__(self, fs: float, notch: int = 60) -> None:
        stages = []
        if notch:
            stages.append(coefficients("notch", fs, notch, 1.0))
        stages.extend([coefficients("lowpass", fs, min(2500, fs * 0.49), 0.5),
                       coefficients("highpass", fs, 1, 0.5)])
        self.stages = [Biquad(c) for c in stages]

    def process(self, raw: float) -> float:
        value = raw - ADC_CENTER
        for stage in self.stages:
            value = stage.process(value)
        return value


def envelope(samples, columns: int):
    """샘플 배열을 columns 개 구간으로 나눠 (min, max) 쌍으로 압축한다. Spike Recorder 의 파형 그리기와 같은 방식."""
    n = len(samples)
    if n == 0 or columns <= 0:
        return []
    out = []
    for c in range(columns):
        lo = c * n // columns
        hi = max(lo + 1, (c + 1) * n // columns)
        chunk = samples[lo:hi]
        out.append((min(chunk), max(chunk)))
    return out


def rms(samples) -> float:
    """구간 평균을 뺀 RMS (표준편차)"""
    n = len(samples)
    if not n:
        return 0.0
    mean = sum(samples) / n
    return math.sqrt(max(0.0, sum(v * v for v in samples) / n - mean * mean))


class ReplayHid:
    """장치 없이 시연·확인하기 위한 가짜 hid 모듈: 저장해 둔 64바이트 보고서 파일을 실제 속도(기본 초당 650개)로 되풀이해 준다."""

    def __init__(self, path: str, reports_per_second: float = 650.0,
                 clock: Callable[[], float] = time.monotonic) -> None:
        with open(path, "rb") as fh:
            data = fh.read()
        self.reports = [data[i:i + 64] for i in range(0, len(data) - 63, 64)]
        if not self.reports:
            raise ValueError("재생 파일에 보고서가 없습니다: " + path)
        self.rate = reports_per_second
        self._clock = clock

    def enumerate(self, vid, pid):
        return [{"path": b"replay"}]

    def device(self):
        return _ReplayDevice(self)


class _ReplayDevice:
    def __init__(self, owner: ReplayHid) -> None:
        self.owner = owner
        self.index = 0
        self.t0 = owner._clock()

    def open_path(self, path):
        self.t0 = self.owner._clock()

    def write(self, data):
        return len(data)

    def read(self, size, timeout):
        o = self.owner
        due = int((o._clock() - self.t0) * o.rate)
        if self.index >= due:
            time.sleep(0.001)
            return []
        report = o.reports[self.index % len(o.reports)]
        self.index += 1
        return list(report)

    def close(self):
        pass


class HidReader:
    """백그라운드 스레드로 SpikerBox Pro 를 열어 필터를 거친 샘플을 쌓는다. 끊기면 다시 찾는다."""

    def __init__(self, seconds: float = 2.0, notch: int = 60, channel: int = 0,
                 hid_module=None, clock: Callable[[], float] = time.monotonic) -> None:
        self.seconds = seconds
        self.notch = notch
        self.channel = channel
        self._hid = hid_module
        self._clock = clock
        self.lock = threading.Lock()
        self.samples: deque = deque(maxlen=int(10000 * seconds))
        self.status = "대기"  # 대기 / 연결됨 / 오류
        self.detail = "SpikerBox 찾는 중"
        self.fps = 0
        self.total = 0
        self.last_frame_at = 0.0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="hid-reader", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)

    def snapshot(self):
        """(샘플 복사본, 상태, 설명, fps)"""
        with self.lock:
            return list(self.samples), self.status, self.detail, self.fps

    def _set(self, status: str, detail: str) -> None:
        with self.lock:
            self.status, self.detail = status, detail
            if status != "연결됨":
                self.fps = 0

    def _run(self) -> None:
        if self._hid is None:
            try:
                import hid  # type: ignore
            except ImportError:
                self._set("오류", "hidapi 가 없습니다: py -m pip install hidapi")
                return
            self._hid = hid
        while not self._stop.is_set():
            try:
                self._session()
            except (OSError, ValueError) as exc:
                self._set("오류", str(exc))
            self._stop.wait(1.0)

    def _session(self) -> None:
        devices = self._hid.enumerate(VID, PID)
        if not devices:
            self._set("대기", "SpikerBox 를 USB 에 연결하고 전원을 켜세요")
            return
        device = self._hid.device()
        device.open_path(devices[0]["path"])
        try:
            # emg.py 와 같은 시작 명령
            if device.write(command("start:;\n")) != 64:
                raise OSError("시작 명령을 다 보내지 못했습니다")
            if device.write(command("board:;\n")) != 64:
                raise OSError("확장보드 질의를 다 보내지 못했습니다")
            decoder = Decoder()
            filters = None
            channels = None
            settle_until = 0.0
            window_start = self._clock()
            window_count = 0
            self.last_frame_at = self._clock()
            while not self._stop.is_set():
                report = device.read(64, 100)
                now = self._clock()
                if report:
                    frames, _ = decoder.feed(bytes(report))
                    if frames:
                        self.last_frame_at = now
                        if len(frames[0]) != channels:
                            channels = len(frames[0])
                            fs = 10000 if channels == 2 else 5000
                            filters = [EmgFilter(fs, self.notch), EmgFilter(fs, self.notch)]
                            settle_until = now + 1.0  # 켠 직후 1초는 필터 안정화 구간
                        idx = self.channel if self.channel < min(2, channels) else 0
                        out = []
                        for f in frames:
                            ys = [filters[0].process(f[0]), filters[1].process(f[1])]
                            out.append(ys[idx])
                        window_count += len(frames)
                        self.total += len(frames)
                        if now >= settle_until:
                            with self.lock:
                                self.samples.extend(out)
                if now - window_start >= 1.0:
                    with self.lock:
                        self.fps = round(window_count / (now - window_start))
                        self.status = "연결됨"
                        self.detail = f"{decoder.channel_count}채널 · 잘못된 프레임 {decoder.bad_frames}"
                    window_start, window_count = now, 0
                if now - self.last_frame_at > STALL_SECONDS:
                    raise OSError("3초 동안 신호가 없습니다. 전원·케이블·다른 앱(Spike Recorder)을 확인하세요")
        finally:
            try:
                device.write(command("h:;\n"))
            except OSError:
                pass
            device.close()
