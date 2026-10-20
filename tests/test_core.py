import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import emg_core as core  # noqa: E402


def encode_frames(frames):
    out = bytearray()
    for f in frames:
        for c, v in enumerate(f):
            out += bytes([(0x80 if c == 0 else 0) | (v >> 7), v & 0x7F])
    return bytes(out)


def message(text):
    return core.BEGIN + text.encode("ascii") + core.END


def reports(data, size=62):
    out = []
    for i in range(0, len(data), size):
        chunk = data[i:i + size]
        out.append((bytes([0x3F, len(chunk)]) + chunk).ljust(64, b"\0"))
    return out


def decode(data, size=62, dec=None):
    dec = dec or core.Decoder()
    frames, messages = [], []
    for r in reports(data, size):
        f, m = dec.feed(r)
        frames += f
        messages += m
    return dec, frames, messages


class DecoderTests(unittest.TestCase):
    def test_frames_are_identical_for_any_report_size(self):
        want = [(512, 600), (700, 400), (0, 1023), (515, 509)]
        data = encode_frames(want + [(512, 512)])  # 마지막 프레임은 다음 시작 바이트가 와야 확정된다
        for size in (62, 7, 1):
            _, frames, _ = decode(data, size)
            self.assertEqual(frames, want, size)

    def test_values_above_1023_and_wrong_length_are_rejected(self):
        data = encode_frames([(512, 512), (2000, 512), (513, 511)]) + bytes([0x82, 1, 2]) + encode_frames([(514, 510), (1, 1)])
        dec, frames, _ = decode(data)
        self.assertEqual(frames, [(512, 512), (513, 511), (514, 510)])
        self.assertEqual(dec.bad_frames, 2)

    def test_device_messages_never_leak_into_samples(self):
        long_text = "INFO:" + "x" * 200 + ";MSF:10000;"
        data = encode_frames([(600, 512), (601, 512)]) + message(long_text) + encode_frames([(602, 512), (603, 512), (604, 512)])
        _, whole, msgs = decode(data)
        _, single, _ = decode(data, 1)
        self.assertEqual(whole, single)
        self.assertEqual(whole, [(600, 512), (601, 512), (602, 512), (603, 512)])
        self.assertEqual(len(msgs), 1)

    def test_board_message_sets_channel_count_and_bad_report_resets(self):
        dec = core.Decoder()
        self.assertEqual(dec.channel_count, 2)
        _, frames, _ = decode(message("BRD:4;") + encode_frames([(1, 2, 3), (4, 5, 6), (7, 8, 9)]), dec=dec)
        self.assertEqual(dec.channel_count, 3)
        self.assertEqual(frames, [(1, 2, 3), (4, 5, 6)])
        bad = bytes([0x3F, 63]) + bytes(62)
        dec.feed(bad)
        self.assertEqual(dec.bad_reports, 1)

    def test_report_with_leading_zero_is_accepted(self):
        r = reports(encode_frames([(512, 512), (1, 2)]))[0]
        frames, _ = core.Decoder().feed(b"\0" + r)
        self.assertEqual(frames, [(512, 512)])

    def test_command_layout(self):
        c = core.command("start:;\n")
        self.assertEqual(len(c), 64)
        self.assertEqual(c[:2], bytes([0x3F, 62]))
        self.assertEqual(c[2:10], b"start:;\n")
        with self.assertRaises(ValueError):
            core.command("x" * 63)


class FilterTests(unittest.TestCase):
    def gain(self, hz, fs=10000):
        f = core.EmgFilter(fs, 60)
        peak = 0.0
        for i in range(fs * 2):
            y = f.process(512 + 100 * math.sin(2 * math.pi * hz * i / fs))
            if i > fs:
                peak = max(peak, abs(y))
        return peak / 100

    def test_mains_is_removed_and_signal_passes(self):
        self.assertLess(self.gain(60), 0.001)
        self.assertAlmostEqual(self.gain(100), 0.728847, places=4)  # 노치(Q=1)가 넓어 100 Hz 도 조금 깎인다
        self.assertGreater(self.gain(150), 0.9)

    def test_dc_center_becomes_zero(self):
        f = core.EmgFilter(10000, 60)
        last = 1.0
        for _ in range(30000):
            last = f.process(512)
        self.assertLess(abs(last), 0.01)

    def test_invalid_frequency_is_rejected(self):
        with self.assertRaises(ValueError):
            core.coefficients("lowpass", 1000, 600, 0.5)


class WaveformTests(unittest.TestCase):
    def test_envelope_keeps_min_and_max_per_column(self):
        samples = [0, 5, -3, 2, 9, -7, 1, 1]
        self.assertEqual(core.envelope(samples, 4), [(0, 5), (-3, 2), (-7, 9), (1, 1)])
        self.assertEqual(len(core.envelope(samples, 8)), 8)
        self.assertEqual(core.envelope([], 10), [])

    def test_rms_removes_the_mean(self):
        self.assertEqual(core.rms([512] * 100), 0.0)
        wave = [512 + 10 * math.sin(2 * math.pi * i / 100) for i in range(1000)]
        self.assertAlmostEqual(core.rms(wave), 10 / math.sqrt(2), delta=0.05)


class ReplayTests(unittest.TestCase):
    def test_replay_delivers_reports_at_the_requested_rate_and_loops(self):
        import tempfile
        data = b"".join(reports(encode_frames([(512, 512)] * 100)))
        path = os.path.join(tempfile.mkdtemp(), "cap.bin")
        with open(path, "wb") as fh:
            fh.write(data)
        t = {"v": 0.0}
        replay = core.ReplayHid(path, reports_per_second=100, clock=lambda: t["v"])
        dev = replay.device()
        dev.open_path(b"replay")
        self.assertEqual(dev.read(64, 100), [])  # 아직 시간이 안 지났다
        t["v"] = 0.05
        got = [dev.read(64, 100) for _ in range(5)]
        self.assertTrue(all(len(r) == 64 for r in got))
        self.assertEqual(dev.read(64, 100), [])  # 5개만 나왔다
        n = len(replay.reports)
        t["v"] = (n + 3) / 100
        for _ in range(n + 3 - 5):
            self.assertEqual(len(dev.read(64, 100)), 64)  # 끝까지 가면 처음부터 되풀이
        empty = os.path.join(os.path.dirname(path), "empty.bin")
        open(empty, "wb").close()
        with self.assertRaises(ValueError):
            core.ReplayHid(empty)


class FakeDevice:
    def __init__(self, payload_reports, stop_after):
        self.reports = list(payload_reports)
        self.written = []
        self.closed = False
        self.stop_after = stop_after

    def open_path(self, path):
        pass

    def write(self, data):
        self.written.append(bytes(data))
        return len(data)

    def read(self, size, timeout):
        if self.reports:
            return list(self.reports.pop(0))
        self.stop_after()
        return []

    def close(self):
        self.closed = True


class ReaderTests(unittest.TestCase):
    def test_reader_sends_emg_py_start_commands_and_collects_filtered_samples(self):
        n = 25000  # 2.5초 (1초 안정화 구간은 버려진다)
        frames = [(int(512 + 40 * math.sin(i / 7)), 512) for i in range(n)]
        data = encode_frames(frames) + encode_frames([(512, 512)])
        clock = {"t": 0.0}

        class FakeHid:
            def __init__(inner):
                inner.dev = None

            def enumerate(inner, vid, pid):
                return [{"path": b"x"}]

            def device(inner):
                inner.dev = FakeDevice(reports(data), reader._stop.set)
                return inner.dev

        def tick():
            clock["t"] += 0.002  # 읽기 한 번에 2 ms (약 1600개 보고서 → 3초 이상이라 1초 안정화 구간이 지나간다)
            return clock["t"]

        reader = core.HidReader(seconds=2.0, hid_module=None, clock=tick)
        fake = FakeHid()
        reader._hid = fake
        reader._session()
        dev = fake.dev
        self.assertEqual([w[2:10].rstrip(b"\0") for w in dev.written[:2]], [b"start:;\n", b"board:;\n"])
        self.assertTrue(dev.closed)
        samples, _, _, _ = reader.snapshot()
        self.assertGreater(len(samples), 1000)
        self.assertLess(max(abs(s) for s in samples), 100)


if __name__ == "__main__":
    unittest.main()
