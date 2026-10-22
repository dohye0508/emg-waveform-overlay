# CLAUDE.md

## 상태: v1.9.0

Python/tkinter 판을 Electron으로 새로 만들었다. 단위 시험·실제 SendInput 시험·화면 넘침 검사·exe 실행 확인은 끝났다. **실제 SpikerBox를 꽂은 상태의 확인(힘 줄 때 키 눌림, 케이블 분리 시 키 해제)과 실제 게임 위 오버레이는 아직 안 했다** (개발 중 장치가 없었다).

## 명령

```bash
npm install
npm start                # 사용자 화면부터. npx electron . --admin 은 관리자 화면부터. npx electron . --demo: 장치 없이 흉내 신호로 화면 확인 (가동하면 실제 키가 나가니 시험 모드로)
npm test                 # node test/all.test.js
npm run test:keys        # electron test/keys.integration.js (실제 SendInput)
npm run build:win        # dist/emg-waveform-overlay.exe
```

개발 복사본은 `--user-data-dir=<임시>`로 띄우면 실제 설정과 섞이지 않는다. `--remote-debugging-port=<포트>`를 붙이면 `node test/layout.check.js <포트> [스크린샷 폴더]`로 설정 화면(1440×900 외 3가지)과 오버레이(50/100/200 %)의 넘침·줄바꿈을 검사한다.

## 결정 사항 (사용자와 정한 것)

- 스코어보드(`festival_raibit`)와 같은 인상이되 색 톤은 다르게: 남회색 바탕, 하늘(쉴 때) / 산호(힘줄 때·키 눌림). 글꼴: 주아체 = 제목·버튼, Pretendard = 라벨·숫자 (v1.1에서 도현체·Bahnschrift 대신). 작은 설명 글씨는 두지 않는다. 칸은 열마다 색이 다르다 (역치 = 호박, 키 = 산호, 화면 = 하늘, 연결·가동 = 민트), 밝은 색은 넓게 칠하지 않는다. 모든 줄 40px·라벨 112px·숫자 칸 76px 로 칸끼리 줄이 맞는다. 위쪽에 실시간 파형·힘 그래프(역치 위는 산호색)·키캡이 있다.
- 연속값은 슬라이더 + 숫자 입력, 이산값만 분할 버튼. 줄바꿈·넘침이 없어야 한다 (`nowrap`, `min-width:0`, 1440×900 설계 + `fit()`).
- v1.2: 2단계 모드(약하게 = `key.code`, 세게 = `key.code2`, `trigger.threshold2`, `key.decideMs`), 프리셋 3칸(`settings.presets`, `activePreset`; 고른 칸에 자동 저장, 단축키는 프리셋에 안 담음), 기본 단축키 Ctrl+1/Ctrl+2 (v1.2.0 은 F8/F9, 예전 기본값 Ctrl+Alt+F9/F10 을 쓰던 설정은 `v` 가 없을 때 한 번 옮김). 단축키는 위쪽 버튼 안 칩을 눌러 바꾼다.
- v1.3: 누를 키에 마우스 버튼(`MouseLeft/Middle/Right/Back/Forward`, 이름은 좌클릭·우클릭·휠클릭·뒤로·앞으로, `keymap.js` 의 `{ mouse }`, `keysender.js` 의 MOUSEINPUT). 칩을 누른 뒤 다음 마우스 입력 하나를 받고, 그 직후의 click 은 무시한다 (`keyCapture`의 `allowMouse`). 단축키 칩은 마우스를 안 받는다. `test/keys.integration.js` 가 가운데·뒤로 버튼을 실제로 보내 확인한다 (시험 창 한가운데로 커서를 옮긴다).
- v1.4: 사용자 모드(`home.html`, 기본 화면)와 관리자 모드(`index.html`, Ctrl+D 로 오간다, `--admin` 으로 바로 시작). 게임은 `src/main/games.js`: `gd` = 공식 웹 데모 `https://www.geometrydash.com/game/index.html`(누르는 동안 유지), `flappy` = `renderer/games/flappy` 에 넣은 nebez/floppybird(Apache-2.0, 사용자가 직접 만든 게임 대신 리포를 원함; `SOURCE.md` 에 출처·커밋·고친 곳: 방문 통계 스크립트 삭제, 아무 키나 받게). 주소 끝이 정확히 `?easy` 여야 쉬운 모드라 `loadURL` 로 연다. 날 수 있는 칸이 420px 고정이라 `fitHeight: 525`(`#gamecontainer` 의 min-height; 470 으로 맞췄을 때 아래 땅이 잘려 비율이 깨졌다) 로 창 높이에 맞춰 확대하고, 픽셀 그림이 고르게 보이게 실제 화면 픽셀 기준 정수 배(1080p 에서 2배, `main.js` 의 `zoomFor`)를 쓴다, 원래 휴대폰 가로 320px 용이라 `games.js` 의 `css` 를 `insertCSS` 로 넣어 가운데 480px 칸만 쓰고 양옆은 비운다(사용자 요청: 더 크게, 양옆은 짧게). 왼쪽 아래 만든 사람 표시(`#footer`)는 사용자 요청으로 숨겼다(출처는 `SOURCE.md`·`LICENSE`). 사용자 화면 GD 카드 그림은 사용자가 준 이미지 `renderer/images/gd-card.webp`. 파이프 틈은 점수에 따라 좁아진다(사용자 요청: 처음은 쉬운 모드 200, 1점마다 3씩, 최소 120; `js/main.js` 의 `gapForScore`, 틈은 파이프마다 `data('gap')` 에 두고 충돌도 그 값으로 본다). 파이프는 원래 x=900 에서 출발해서 새 키프레임 `animPipeNarrow`(500→-100, 4.5초, 원래 속도 유지)로 바꿨다. 같은 이름 `animPipe` 로 덮으면 원래 것이 이기고, 페이지 CSS 를 이기려면 `!important` 가 필요하다(한 번만). 게임 창은 전체화면 BrowserWindow(앱 기능 없음, 다른 페이지로 이동·새 창 막음, `backgroundThrottling:false`)이고, 게임 중 키는 `webContents.sendInputEvent` 로 그 창에 직접 넣는다(`keymap.injectOf`; 숫자패드·뒤로/앞으로 버튼은 넣을 수 없어 SendInput 으로). 게임 중에는 1단계·게임별 키(`settings.user.keys`, 프리셋에 안 담김)를 쓰고 역치·타이밍은 관리자 설정을 그대로 쓴다. Esc 는 게임 중에만 전역 단축키로 잡아 게임을 닫는다. 실측: 흉내 신호로 GD 큐브가 점프하고 floppybird 가 Splash→Game→Score 를 반복한다. 게임 창이 다른 창에 완전히 가려지면 화면이 멈춰서 `backgroundThrottling:false` 를 줬다.
- v1.5: 세 번째 게임 `adofai`(얼음과 불의 춤, Steam app 977950, 사용자가 정식판을 깔았다). `games.js` 의 `native: true` 게임은 앱 창이 아니라 Windows 프로그램: `winfocus.js`(koffi: `FindWindowW` 로 제목 `A Dance of Fire and Ice` 를 찾고, 앞 창 스레드에 `AttachThreadInput` + Alt 키를 눌러 `SetForegroundWindow`)로 앞으로 가져오고 키는 SendInput. 꺼져 있으면 `steam://rungameid/977950` 로 켜고 창이 뜰 때까지 90초 기다린다. 돌아오기는 게임 중에만 전역 `Ctrl+Q`(게임이 Esc 를 일시정지로 써서), 게임은 끄지 않고 둔다(미리 켜 두기, 카드의 `미리 켜기` → 창이 뜨면 사용자 화면을 다시 앞으로). 1초마다 창이 있는지 보고, 하는 중에 게임이 꺼지면 사용자 화면으로 돌아온다. 사용자 화면은 카드 3칸(그림 칸 16:9), 얼불춤 카드 그림은 사용자가 준 `images/adofai-card.png`. 실측: 시작 → 얼불춤이 앞으로 오고 오버레이가 위에 뜸, Ctrl+Q → 사용자 화면, 게임은 계속 켜져 있음. 아직: 꺼진 상태에서 Steam 으로 켜기·미리 켜기(사용자가 게임을 켜 둔 상태라 못 해 봄), 실제 근육으로 박자 맞추기(입력 지연은 게임 안 오프셋으로).
- v1.6: 네 번째 게임 `invaders` = trungvose/space-invaders-phaser-3 (MIT, Phaser 3.22). 사용자가 "직접 만든 싸구려 말고 공개 리포"를 원해서, 처음 넣은 dwmkerr/spaceinvaders(사각형 그래픽)를 이것으로 바꿨다. 리포에 빌드 파일이 없어 `src/` 를 고친 뒤 리포 방식(`npm ci`, `npm run build`)으로 만든 `game.js` 를 넣었다 (고친 곳은 `games/invaders/SOURCE.md`: 자동 발사, ←/→ 로 새 게임, 끝난 뒤 1.5초 무시, `/assets` → `assets`, 안내 글). 2단계 게임이라 `games.js` 의 `levels: 2`, 사용자 설정 `user.keys2`(세게 키, 약하게 키와 같거나 Esc 면 기본값). 카드 그림은 게임 화면을 잘라 만든 `images/invaders-card.png`. 사용자 화면은 카드 4칸, 카드 높이는 내용에 맞추고 카드+힘 막대를 세로 가운데.
- v1.7: 다섯 번째 게임 `stack` = zurkon/playstack (MIT, React + Three.js + cannon.js, Ketchapp STACK 클론). 리포 `src/` 를 고친 뒤 `vite build --base=./` 한 `dist/` 를 넣었다 (고친 곳은 `games/stack/SOURCE.md`: 아무 키로도 놓기, 속도 0.15→0.09, 게임오버 뒤 1.2초 무시, z 방향 블록도 떨어지게, 한국어 안내). `file://` 에서 ES 모듈이 문제없이 뜬다. 사용자 화면은 카드 5칸이고 카드 그림은 모두 실제 게임 화면(또는 사용자가 준 그림)을 16:9 로 자른 이미지(`images/*-card.*`). Flappy 카드는 예전 픽셀 그림 조합(CSS)을 지우고 Get Ready 화면 캡처로 바꿨다.
- v1.8: 여섯 번째 게임 `breakout`(벽돌깨기) = toji/spookyball (MIT, WebGPU 할로윈 벽돌깨기). 처음 본 budnix/ball-and-wall 은 Bower·Grunt 빌드가 필요하고 일부 그림이 유료라 뺐다. 라이브러리는 리포 lock 으로 `npm ci` 해서 필요한 파일만 `games/breakout/vendor/` 에 (이름을 node_modules 에서 바꿈), 인터넷이 필요한 Draco 디코더와 Creepster 글꼴은 같은 것을 받아 넣었다 (`SOURCE.md`). 2단계(약하게 ←, 세게 →), 움직이면 공 발사, 게임오버 뒤 아무 키로 Replay. 이 노트북(Intel Gen12)에서 WebGPU 확인. Bash 도구의 네트워크가 가끔 막혀서 `gh`·`npm` 은 PowerShell 로 돌렸다. 사용자 화면 카드 6칸.
- v1.9: 일곱 번째 게임 `copter`(카드 이름 `Helicopter Game`) = js-canvas-copter(WTFPL) 물리·틀 + Kenney Tappy Plane(CC0) 그림. 사용자는 "공개 리포 기반, 그래픽은 고퀄리티"를 원했고, 직접 캔버스에 그린 첫 판은 "구리다"고 해서 Kenney 그림으로 바꿨다. 떨어지는 속도가 일정해 부자연스럽다고 해서 물리를 중력+공기 저항으로 바꿨다 (`games/copter/SOURCE.md`). 사용자 화면은 4칸 × 2줄, 힘 막대는 머리줄로 옮김.
- v1.10: 여덟 번째 게임 `jumper`(`Bunny Jump`, 두들 점프류) = ourcade/infinite-jumper-template-phaser3(MIT) + Kenney Jumper Pack(CC0), Phaser 3.55.2 는 `vendor/` 에. 2단계(약하게 ←, 세게 →). 템플릿 그대로의 첫 판은 "카메라도 이상하고 너무 정적"이라 해서, 카메라는 위로만 부드럽게, 높이에 따른 하늘색·별·흐르는 구름, 움직이는/부서지는 발판, 스프링·제트팩·적·도는 코인, 토끼 찌그러짐을 넣었다 (`games/jumper/SOURCE.md`). 디버그용으로 `window.__game` 이 있다.
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
