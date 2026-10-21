# floppybird (외부 코드)

- 출처: https://github.com/nebez/floppybird (`gh-pages`, 커밋 `efd2c7f740299688e524e57bfa3f635c9b857f82`, 2026-02-16)
- 라이선스: Apache-2.0 (`LICENSE`)
- 뺀 것: `screencap.png`, `assets/*.psd`, `tsconfig.json`, `README.md`, `.gitignore`
- 고친 것: `index.html` 의 외부 방문 통계 스크립트(`yummy.nebez.dev`) 한 줄을 지웠다 (오프라인 동작, 방문자 정보 전송 없음). `js/main.js` 의 키 입력 한 곳. 원래는 스페이스만 받던 것을 Esc 가 아닌 아무 키나 받게 하고 반복 입력은 뺐다 (EMG Overlay 에서 게임별 키를 고를 수 있게).
- EMG Overlay 는 `index.html?easy`(파이프 틈 200) 로 연다.
- 고친 것(v1.4.3): 파이프 틈이 점수에 따라 좁아진다 (`gapForScore`: 쉬운 모드 200 에서 1점마다 3씩 줄어 120 까지). 틈은 파이프마다 `data('gap')` 에 저장하고 충돌 검사도 그 파이프의 틈을 쓴다.
