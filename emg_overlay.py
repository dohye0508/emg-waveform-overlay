"""SpikerBox 근전도 파형 오버레이 (Spike Recorder 스타일).

- USB HID 로 연결한 SpikerBox Pro(2E73:0001)의 값을 실시간 파형으로 그린다.
- 어두운 배경 + 격자 + 흐르는 파형. 쉴 때는 연두색, 힘을 주면(RMS 가 기준 이상) 주황색.
- 항상 맨 위에 떠 있고, 마우스 클릭은 아래 창(게임)으로 그대로 통과된다.
- 종료: 콘솔 창에서 Ctrl+C. Spike Recorder 가 장치를 잡고 있으면 열리지 않으니 먼저 끈다.
"""
from __future__ import annotations

import argparse
import ctypes
import sys
import tkinter as tk

import emg_core

# Spike Recorder 색상 (src/widgets/Color.h, src/AudioView.cpp)
BG = "#191919"
GRID = "#2E2E2E"
CENTER = "#454545"
IDLE_COLOR = "#E1FC5A"
ACTIVE_COLOR = "#FF8A5B"
MUTED = "#8C8C8C"
TEXT = "#B4B4B4"
ERROR = "#FF6A6A"

W, H = 520, 170
HEADER = 26
FRAME_MS = 33
RMS_WINDOW = 1000  # 마지막 0.1초(10 kHz 기준)로 RMS 를 낸다


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="SpikerBox 근전도 파형 오버레이")
    p.add_argument("--channel", type=int, choices=(1, 2), default=1, help="표시할 채널 (기본 1)")
    p.add_argument("--seconds", type=float, default=2.0, help="화면에 보이는 시간(초) (기본 2)")
    p.add_argument("--scale", type=float, default=200.0, help="세로 맨 위·아래 끝의 값(ADC 카운트) (기본 200)")
    p.add_argument("--threshold", type=float, default=15.0, help="이 RMS 이상이면 주황색 (기본 15)")
    p.add_argument("--notch", choices=("60", "50", "off"), default="60", help="전원 잡음 노치 Hz (기본 60)")
    p.add_argument("--alpha", type=float, default=0.95, help="창 투명도 0.3~1 (기본 0.95)")
    p.add_argument("--replay", metavar="FILE", help="장치 없이 저장해 둔 64바이트 보고서 파일을 실제 속도로 재생 (시연·확인용)")
    p.add_argument("--x", type=int, help="창 왼쪽 위 x (기본: 화면 오른쪽)")
    p.add_argument("--y", type=int, help="창 왼쪽 위 y (기본: 화면 세로 가운데)")
    return p


def make_click_through(root: tk.Tk) -> None:
    """클릭이 아래 창으로 통과되도록 윈도우 스타일을 바꾼다 (Windows 전용)"""
    root.update_idletasks()
    GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT = -20, 0x80000, 0x20
    hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
    style = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
    ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED | WS_EX_TRANSPARENT)


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    if args.seconds <= 0 or args.scale <= 0:
        print("--seconds 와 --scale 은 0보다 커야 합니다", file=sys.stderr)
        return 2

    try:
        replay = emg_core.ReplayHid(args.replay) if args.replay else None
    except (OSError, ValueError) as exc:
        print(f"재생할 수 없습니다: {exc}", file=sys.stderr)
        return 2
    reader = emg_core.HidReader(seconds=args.seconds, notch=0 if args.notch == "off" else int(args.notch),
                                channel=args.channel - 1, hid_module=replay)
    reader.start()

    root = tk.Tk()
    root.attributes("-topmost", True)
    root.overrideredirect(True)
    root.configure(bg=BG)
    root.attributes("-alpha", min(1.0, max(0.3, args.alpha)))
    x = args.x if args.x is not None else root.winfo_screenwidth() - W - 40
    y = args.y if args.y is not None else root.winfo_screenheight() // 2 - H // 2
    root.geometry(f"{W}x{H}+{x}+{y}")

    canvas = tk.Canvas(root, width=W, height=H, bg=BG, highlightthickness=0)
    canvas.pack()
    plot_h = H - HEADER
    mid = HEADER + plot_h / 2
    half = plot_h / 2 - 4

    for gx in range(0, W + 1, 52):
        canvas.create_line(gx, HEADER, gx, H, fill=GRID)
    for gy in (HEADER + plot_h * 0.25, HEADER + plot_h * 0.75):
        canvas.create_line(0, gy, W, gy, fill=GRID)
    canvas.create_line(0, mid, W, mid, fill=CENTER)
    canvas.create_line(0, HEADER, W, HEADER, fill=CENTER)

    channel_text = canvas.create_text(10, HEADER / 2, text=f"CH {args.channel}", anchor="w", fill=IDLE_COLOR,
                                      font=("Consolas", 10, "bold"))
    info_text = canvas.create_text(W - 10, HEADER / 2, text="", anchor="e", fill=MUTED, font=("Malgun Gothic", 9))
    trace = canvas.create_line(0, mid, W, mid, fill=MUTED, width=1)
    make_click_through(root)

    def tick() -> None:
        samples, status, detail, fps = reader.snapshot()
        if status == "연결됨" and samples:
            level = emg_core.rms(samples[-RMS_WINDOW:])
            color = ACTIVE_COLOR if level >= args.threshold else IDLE_COLOR
            pts = []
            for i, (lo, hi) in enumerate(emg_core.envelope(samples, W)):
                # 화면 위쪽이 +. 최소·최대를 한 열에 세로선으로 이어 Spike Recorder 처럼 그린다.
                pts.extend((i, mid - max(-1.0, min(1.0, lo / args.scale)) * half,
                            i, mid - max(-1.0, min(1.0, hi / args.scale)) * half))
            canvas.coords(trace, *pts)
            canvas.itemconfig(trace, fill=color)
            canvas.itemconfig(channel_text, fill=color)
            canvas.itemconfig(info_text, text=f"RMS {level:5.1f}  ·  {fps} fps", fill=TEXT)
        else:
            canvas.coords(trace, 0, mid, W, mid)
            canvas.itemconfig(trace, fill=MUTED)
            canvas.itemconfig(channel_text, fill=MUTED)
            canvas.itemconfig(info_text, text=detail, fill=ERROR if status == "오류" else MUTED)
        root.after(FRAME_MS, tick)

    tick()
    print("파형 오버레이 실행 중... Ctrl+C 로 종료")
    try:
        root.mainloop()
    except KeyboardInterrupt:
        pass
    finally:
        reader.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
