# SpookyBall (외부 코드)

- 출처: https://github.com/toji/spookyball (`main`, 커밋 `cd816b2f200ef85c9396211ced062ffee35f5a15`, 2026-06-09). WebGPU 로 그리는 할로윈 벽돌깨기.
- 라이선스: MIT (`LICENSE`)
- 라이브러리는 리포 `package-lock.json` 그대로 `npm ci` 해서 필요한 파일만 `vendor/` 에 넣었다 (각 폴더에 라이선스): gl-matrix, web-texture-tool(build 만), wgsl-preprocessor, dat.gui, stats.js, matter-js (모두 MIT/BSD 계열). `node_modules` 이름은 electron-builder 가 따로 다루므로 `vendor` 로 바꾸고 `index.html` 의 import map 경로를 고쳤다.
- 인터넷 없이 되게:
  - Draco 메시 디코더(원래 `https://www.gstatic.com/draco/versioned/decoders/1.4.1/draco_decoder_gltf.js`)를 같은 버전으로 받아 `vendor/draco/` 에 넣고(Apache-2.0) `js/engine/loaders/lib/draco-worker.js` 가 그걸 쓰게 했다.
  - Google Fonts 의 Creepster 글꼴을 `fonts/` 에 넣었다(OFL).
- 지운 것: `index.html` 의 WebGPU origin trial 메타, 방문 통계 스크립트(web3dsurvey), Google Fonts 링크, 아래 GitHub 링크, 아이콘 링크. `media/` 의 `gltf-minify.sh`, `screenshot.png`, 아이콘들.
- 고친 것:
  - `js/player.js`: 왼쪽·오른쪽으로 움직이면 공도 발사 (근육으로는 좌우만 낸다).
  - `js/html-display.js`: 게임오버 뒤 아무 키(Esc 빼고)로 "Replay?" (끝난 뒤 1.5초는 무시).
- EMG Overlay 에서는 약하게 = ←, 세게 = → (2단계, 누르는 동안 유지). WebGPU 가 필요하다 (이 노트북 Intel Gen12 에서 확인).
