# CLAUDE.md

## 상태: v1.1.0

Python/tkinter 판을 Electron으로 새로 만들었다. 단위 시험·실제 SendInput 시험·화면 넘침 검사·exe 실행 확인은 끝났다. **실제 SpikerBox를 꽂은 상태의 확인(힘 줄 때 키 눌림, 케이블 분리 시 키 해제)과 실제 게임 위 오버레이는 아직 안 했다** (개발 중 장치가 없었다).

## 명령

```bash
npm install
npm start                # npx electron . --demo: 장치 없이 흉내 신호로 화면 확인 (가동하면 실제 키가 나가니 시험 모드로)
npm test                 # node test/all.test.js
npm run test:keys        # electron test/keys.integration.js (실제 SendInput)
npm run build:win        # dist/emg-waveform-overlay.exe
```

개발 복사본은 `--user-data-dir=<임시>`로 띄우면 실제 설정과 섞이지 않는다. `--remote-debugging-port=<포트>`를 붙이면 `node test/layout.check.js <포트> [스크린샷 폴더]`로 설정 화면(1440×900 외 3가지)과 오버레이(50/100/200 %)의 넘침·줄바꿈을 검사한다.

## 결정 사항 (사용자와 정한 것)

- 스코어보드(`festival_raibit`)와 같은 인상이되 색 톤은 다르게: 남회색 바탕, 하늘(쉴 때) / 산호(힘줄 때·키 눌림). 글꼴: 주아체 = 제목·버튼, Pretendard = 라벨·숫자 (v1.1에서 도현체·Bahnschrift 대신). 작은 설명 글씨는 두지 않는다. 칸은 열마다 색이 다르다 (역치 = 호박, 키 = 산호, 화면 = 하늘, 연결·가동 = 민트), 밝은 색은 넓게 칠하지 않는다. 모든 줄 40px·라벨 112px·숫자 칸 76px 로 칸끼리 줄이 맞는다. 위쪽에 실시간 파형·힘 그래프(역치 위는 산호색)·키캡이 있다.
- 연속값은 슬라이더 + 숫자 입력, 이산값만 분할 버튼. 줄바꿈·넘침이 없어야 한다 (`nowrap`, `min-width:0`, 1440×900 설계 + `fit()`).
- 키는 `e.code`로 지정하고 `SendInput`을 스캔코드 방식으로 보낸다 (게임이 읽는 방식). 단축키는 Electron `globalShortcut`.
- 역치는 직접 입력하거나 자동 설정(스코어보드 `calib.js` 기반)으로 정한다. 제안만 하고 `적용`을 눌러야 바뀐다.
- 정지·신호 끊김(0.5초)·설정 변경·종료 때는 눌린 키를 반드시 뗀다.
- 커밋 메시지는 영어, 공동작업자 줄 없음. 푸시는 사용자 확인 후.

## 구조

- `src/main/main.js` 상태와 타이밍 전부 (창, 트레이, IPC, 단축키). 렌더러는 payload를 그리기만 한다.
- `hidinput.js` 장치 탐색·재연결·정지 감지, 필터 거친 샘플 방출. `hid.js`/`emg.js`는 스코어보드에서 복사 (emg.py와 같은 디코더).
- `engine.js` 구간 RMS → 역치(히스테리시스) → hold/tap 키 이벤트. `keysender.js` koffi로 user32 SendInput. `keymap.js` 키 코드 ↔ 스캔코드·단축키 문자열.
- `layout.js` 오버레이 위치·크기(% ↔ 픽셀)와 파형 압축. `store.js` 설정 저장·정리.
- `calib.js` 자동 설정(쉬기 4 · 준비 2 · 힘주기 4초)과 `suggestThreshold`.

## 한계·주의

- 독점 전체화면에서는 오버레이가 안 보인다. 관리자 권한 게임에는 키 주입이 막힌다(UIPI).
- SpikerBox는 한 번에 한 프로그램만 연다 (스코어보드와 동시 실행 불가).
- 이 PC는 심볼릭 링크 권한이 없어 빌드에 `-c.win.signAndEditExecutable=false`가 필요하다 (`npm run build:win`에 들어 있다).
- `node-hid`·`koffi`는 `asarUnpack`에 있어야 한다. `npmRebuild:false`.
