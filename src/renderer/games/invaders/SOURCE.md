# space-invaders-phaser-3 (외부 코드)

- 출처: https://github.com/trungvose/space-invaders-phaser-3 (`master`, 커밋 `c3d0a8d4ba597a298ef8d6044025bf098c1c0503`, 2020-08-16)
- 라이선스: MIT (`LICENSE`). 엔진은 Phaser 3.22.0 (MIT, `game.js` 안에 같이 묶여 있다)
- `game.js` 는 리포의 `src/` 를 고친 뒤 리포의 방법(`npm ci`, `npm run build` = rollup)으로 빌드한 것이다. 리포에는 빌드된 파일이 없다.
- 고친 것 (`src/scenes/main.ts`, `src/interface/manager/score-manager.ts`):
  - 자동 발사 (게임 중이면 발사 키를 누르지 않아도 쏜다. 근육으로는 좌우만 움직인다)
  - 게임오버·승리 화면에서 ←/→ 로도 새 게임 (끝난 뒤 1.5초는 무시)
  - 그림·소리 불러오는 경로 `/assets` → `assets` (파일로 열어도 되게)
  - 안내 글 "PRESS SPACE FOR NEW GAME" → "힘을 주면 새 게임"
- `index.html`: 외부 링크 버튼, GitHub 별 iframe, Google Analytics 를 지우고 css 경로를 상대 경로로.
- 뺀 것: `assets/readme/`(사용자 화면 카드 그림으로 `renderer/images/invaders-card.png` 만 씀), `assets/favicon.png`
- EMG Overlay 에서는 약하게 = ←, 세게 = → (2단계, 누르는 동안 유지).
