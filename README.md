# EMG Overlay

SpikerBox Pro(근전도)의 신호를 게임 화면 위에 파형으로 띄우고, 근육에 힘을 주면 지정한 키가 눌리게 하는 Windows 앱입니다. Electron으로 만들었고 스코어보드(`festival_raibit`)와 같은 장치 읽기·필터 코드를 씁니다.

## 사용

1. SpikerBox를 USB로 연결하고 `emg-waveform-overlay.exe`를 실행합니다.
2. 오른쪽 위 `가동 시작`을 누르거나 단축키(기본 `Ctrl+Alt+F9`)를 누르면 오버레이가 화면 위에 고정되고 키 입력이 켜집니다.
3. `역치 자동 설정`에서 쉬기 4초, 준비 2초, 힘주기 4초를 하면 이 컴퓨터·이 사람에게 맞는 역치를 제안합니다. `적용`을 눌러야 바뀝니다.
4. `시험 모드`를 켜면 키는 보내지 않고 오버레이의 키 칩만 반응합니다. 먼저 이걸로 확인하세요.

## 설정

- 연속값(역치, 크기, 위치, 투명도, 표시 시간 등)은 슬라이더와 숫자 입력으로 정합니다.
- `화면에서 끌어 정하기`: 오버레이를 실제 화면에서 끌고 모서리로 크기를 조절한 뒤 `끌기 끝내기`.
- 키·단축키 칸을 누르고 원하는 키를 치면 저장됩니다.
- 방식 `유지`는 힘을 주는 동안 키를 누르고 있고, `한 번만`은 힘을 줄 때마다 한 번 눌렀다 뗍니다.
- 설정은 `%APPDATA%\EMG Overlay\settings.json`에 저장됩니다.

## 한계

- 독점 전체화면(exclusive fullscreen)에서는 Windows가 어떤 오버레이도 그릴 수 없습니다. 테두리 없는 전체화면에서는 보입니다.
- 관리자 권한으로 실행된 게임에는 키가 들어가지 않습니다. 이 앱도 관리자 권한으로 실행하세요.
- SpikerBox는 한 번에 한 프로그램만 열 수 있습니다. 스코어보드·Spike Recorder와 동시에 쓸 수 없습니다.

## 개발

```bash
npm install
npm start              # 개발 실행
npm test               # 단위 시험 (장치·Electron 필요 없음)
npm run test:keys      # 실제 SendInput 시험 (시험 중 키보드를 건드리지 마세요)
npm run build:win      # dist/emg-waveform-overlay.exe
```

서명 도구의 심볼릭 링크 권한이 없는 PC에서는 `npx electron-builder --win portable --x64 -c.win.signAndEditExecutable=false`로 빌드합니다. 화면 넘침 검사는 앱을 `--remote-debugging-port=9333`으로 띄운 뒤 `node test/layout.check.js 9333`.
