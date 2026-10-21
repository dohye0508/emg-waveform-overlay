# playstack (외부 코드)

- 출처: https://github.com/zurkon/playstack (`main`, 커밋 `9b3b797a8ca4a9cb35ac2744dac0757c72eec3f4`, 2022-04-03). Ketchapp STACK 을 React + Three.js + cannon.js 로 따라 만든 것.
- 라이선스: MIT (`LICENSE`). 묶인 라이브러리: React, Three.js, cannon.js (모두 MIT)
- 리포의 `src/` 를 고친 뒤 리포의 방법(`npm ci`, vite)으로 `vite build --base=./` 해서 나온 `dist/` 를 넣었다.
- 고친 것:
  - `src/components/CanvasContainer.jsx`: 클릭뿐 아니라 아무 키(Esc 빼고, 반복 입력 빼고)로도 블록을 놓는다.
  - `src/lib/game.js`: 블록 속도 0.15 → 0.09 (근육 입력이 클릭보다 늦게 반응해서), 게임오버 뒤 1.2초는 입력 무시, 못 놓고 지나간 블록을 떨어뜨리는 검사를 움직이는 방향으로 (원래는 x 방향만 봐서 z 방향 블록은 끝없이 갔다).
  - 안내 글 한국어, `index.html` 의 아이콘 링크 제거.
- EMG Overlay 에서는 힘을 줄 때마다 한 번(한 번만 누르기).
