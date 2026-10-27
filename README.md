# 페르소나 공방

RisuAI API v3 플러그인. 페르소나 작성, 보관함, 채팅 연결과 이미지 선택을 한곳에서 관리합니다.

## 기본 페르소나 이미지 · 0.3.1

기본 정보 상단의 **기본 이미지 템플릿**에서 자동 선택·직접 선택·커스텀 업로드를 사용할 수 있습니다.

- 빈 초안은 자동 선택 모드입니다. 성별·종족·나이·시대/세계관 템플릿에 맞는 그림을 내장 미리보기로 표시합니다.
- 나이는 13세 미만 아동, 13~19세 청소년, 20~39세 청년, 40~64세 중년, 65세 이상 노년으로 분류합니다. 미입력·불명은 청년 기준이며 안내문에 표시합니다.
- 성별·종족·나이대가 일치하는 그림이 없으면 자동 선택하지 않습니다. 시대는 일치하는 그림을 우선하며, 해당 시대 그림이 없으면 같은 성별·종족·나이대의 그림을 사용합니다.
- **보관함 저장·페르소나 적용** 시 선택한 원본만 GitHub에서 내려받아 Risu 에셋으로 저장합니다. 토글 변경만으로 원본을 받지 않습니다.
- **기본 템플릿에서 고르기**, 커스텀 업로드, 기존 페르소나 이미지 선택은 수동 모드로 전환합니다. 토글을 바꿔도 유지하며 **토글에 따라 자동 선택**으로 복귀할 수 있습니다. 기존 이미지가 있는 옛 보관함 항목도 수동으로 유지합니다.

- 현대·판타지·SF, 총 21종을 제공합니다. 인간·엘프·드워프·수인·용인과 아동·청소년·청년·중년·노년을 포함합니다. 현재 제공하는 종족·나이대 조합마다 남녀가 모두 있습니다. 모든 종족과 나이대의 조합을 제공하는 것은 아닙니다.
- 시대 분류와 종족·나이대 필터를 함께 적용할 수 있습니다. 판타지 종족의 나이대는 외형 기준입니다.
- 목록의 작은 미리보기는 플러그인에 포함되어 있습니다. 목록을 열기만 해서는 원본을 다운로드하지 않습니다.
- 사용 버튼을 누르면 선택한 **832×1216 WebP** 한 장만 GitHub에서 받고, 파일 크기·SHA-256·해상도를 확인한 뒤 `Risuai.saveAsset`으로 저장합니다.
- 이미지는 현재 편집 중인 초안에만 들어갑니다. 이름·설정은 바뀌지 않습니다. 보관함에 저장하거나 채팅에 적용하는 동작은 별도로 실행합니다.
- 한번 Risu 에셋으로 저장된 이미지는 GitHub 연결이나 플러그인 유지 여부와 관계없이 Risu에 남습니다.
- 다운로드 오류는 다시 시도할 수 있습니다. 가져오는 중 취소하면 초안에 반영하지 않습니다.

설치할 때는 `persona-forge.plugin.js`를 RisuAI의 플러그인 설정에서 가져옵니다.

## 이미지 저장 구조

| 경로 | 용도 |
| --- | --- |
| `assets-src/personas/*.png` | GPT 이미지 생성 원본, 보존용 |
| `assets-src/personas/prompts.json` | 이미지별 생성 프롬프트와 원본 크기 |
| `assets-src/personas/catalog.json` | 이름·분류·설명·GitHub 다운로드 기본 주소 |
| `templates/personas/*.webp` | 배포용 832×1216 이미지 |
| `templates/personas/manifest.json` | 파일명·크기·해상도·해시·원본 정보 |
| `scripts/build-portraits.py` | 배포 이미지와 내장 미리보기 생성 |

이미지는 built-in GPT `image_gen`으로 각각 한 장씩 생성했습니다. NAI 생성은 사용하지 않았습니다. 생성 원본 크기는 `manifest.json`에 기록하며, 배포본은 **그림 전체를 832×1216으로 축소**했습니다. 부분 보정, 잘라내기, 합성은 하지 않았습니다.

배포 파일명에는 내용 해시가 포함됩니다. 이미지를 교체할 때 다른 파일명이 생겨 이전 캐시와 섞이지 않습니다. 공개 GitHub 저장소의 `templates/personas/` 경로에서 플러그인에 적힌 파일들을 제공해야 원본 다운로드가 동작합니다.

## 이미지 추가·변경

1. 생성 원본 PNG를 `assets-src/personas/<id>.png`로 넣습니다. `id`는 영문 소문자·숫자·하이픈을 사용합니다.
2. `catalog.json`에 같은 `id`의 이름·분류·종족(`species`)·나이대(`ageGroup`)·설명을 추가합니다. 저장소를 바꾸면 `baseUrl`도 바꿉니다.
3. `python3 scripts/build-portraits.py`를 실행합니다. Python 3와 Pillow가 필요합니다.
4. 이미지와 목록을 확인하고 플러그인 버전을 올립니다. 원본·WebP·manifest·플러그인을 함께 Git에 저장하고 게시합니다.

원본 비율이 832:1216과 크게 다르면 빌드가 멈춥니다. 자동 크롭하지 않으므로 원본 구도를 먼저 확인해야 합니다.

## 검증

```sh
node --check persona-forge.plugin.js
python3 scripts/build-portraits.py
# Playwright 및 Chromium이 설치된 환경에서:
node tests/gallery.cjs
```

브라우저 시험은 가짜 Risu 호스트를 사용합니다. 1280·390·320px에서 목록, 분류, 선택, 취소, 실패 후 재시도, 해시 불일치 거부, 기존 내용 보존을 검사하며 실제 모델이나 라이브 데이터에 접근하지 않습니다. 실제 Risu API 확인은 별도로 RISU-LAB에서 수행합니다.

로컬 백업·배포 스크립트·LAB 시험 결과는 공개 저장소에 포함하지 않습니다.

## 업데이트 서버와 릴리즈

- 설치 파일: https://github.com/canister2668/Risu-persona-forge/releases/latest
- 공식 Risu 업데이트 주소: https://raw.githubusercontent.com/canister2668/Risu-persona-forge/main/persona-forge.plugin.js
- 버전/해시 매니페스트: https://raw.githubusercontent.com/canister2668/Risu-persona-forge/main/update/latest.json
- 공방 설정 → 업데이트에서 최신 버전을 확인하고 SHA-256 검증된 설치 파일을 받을 수 있습니다. 실제 설치는 RisuAI 설정 → 플러그인의 업데이트 또는 파일 가져오기를 사용합니다.
- 원본 이미지는 GitHub `templates/personas/`에서 필요할 때만 받습니다.
- 릴리즈 절차: 버전 헤더와 RELEASE_VERSION을 함께 올리고 `python3 scripts/build-release.py`, `node tests/update.cjs`, `node tests/gallery.cjs`를 실행합니다. 같은 커밋을 main과 v버전 태그로 게시하고 플러그인·소스 ZIP·매니페스트를 GitHub Release에 첨부합니다.
