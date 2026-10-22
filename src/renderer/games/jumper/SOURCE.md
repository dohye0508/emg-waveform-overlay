# Bunny Jump 출처

- 바탕 코드: [ourcade/infinite-jumper-template-phaser3](https://github.com/ourcade/infinite-jumper-template-phaser3), 커밋 `11c03f25b075f31cc44886e207d91955e6920094`, MIT (`LICENSE`). 템플릿의 `src/main.js`, `src/scenes/Game.js`, `src/scenes/GameOver.js`, `src/lib/phaser.js` 와 소리 `assets/phaseJump1.wav` 를 바탕으로 했다.
- 그림: [Kenney Jumper Pack](https://kenney.nl/assets/jumper-pack), CC0 (`assets/Kenney-License.txt`). 배경 `bg_layer*` 는 1024×1024 로 줄였고 나머지는 원본 크기.
- Phaser 3.55.2 (MIT, `vendor/phaser-LICENSE.md`): 템플릿은 CDN 에서 받지만 오프라인에서도 되도록 `vendor/phaser.min.js` 로 넣었다.
- 글꼴: 주아체 (OFL, `fonts/Jua-OFL.txt`).

## 고친 곳

- 템플릿의 `Carrot.js` 는 빼고, `Game.js` 를 크게 고쳐 썼다:
  - 카메라는 위로만 부드럽게 따라간다 (떨어지면 화면 아래로 빠져서 끝).
  - 하늘은 높이에 따라 낮 → 노을 → 밤(별)으로 바뀌고, 먼 구름이 흘러가며, 언덕 배경은 시차를 두고 내려간다. 양옆 빈 곳도 같은 하늘색.
  - 발판: 구름(살랑살랑), 풀 → 모래 → 눈 → 돌(높이에 따라), 작은 발판, 좌우로 움직이는 발판, 밟으면 부서지는 발판(튀지 않음). 풀·버섯·선인장 장식.
  - 스프링(높이 튐), 제트팩(2.2초 상승, 불꽃), 날개 달린 적(위에서 밟으면 +30, 옆에서 부딪치면 끝), 도는 코인(+10), 금 당근(+50).
  - 토끼는 물리 몸통과 그림을 나눠 착지할 때 찌그러지고 오를 때 늘어나며, 움직이는 쪽으로 기운다. 먼지·조각·반짝이 입자.
  - 중력 1300, 점프 -760, 좌우는 부드럽게 가속. 시작 화면("힘을 주면 시작"), 최고 높이 선.
  - 효과음(코인·스프링·부서짐 등)은 `src/sfx.js` 에서 Web Audio 로 만든다.
- `GameOver.js`: 한국어 결과판(높이·코인·점수·최고 점수), 끝나고 1.2초 뒤 Esc 를 뺀 아무 키로 다시 시작.
- 조작: 약하게 = ←, 세게 = → (EMG Overlay 가 키를 보낸다).
