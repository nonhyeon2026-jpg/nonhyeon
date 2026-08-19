# 논현동 재개발구역 지도

서울 강남구 논현동의 재개발 / 공공재개발 / 모아타운 구역을 **지번(필지) 단위**로 지도 위에 표시하고,
관리자가 필지를 구역에 편입하거나 제외할 수 있는 웹앱입니다.

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **배경지도**: 네이버 지도 JS API v3 (지적편집도 레이어 포함) — 키가 없으면 Leaflet + OSM 으로 자동 대체
- **필지 도형**: VWorld 연속지적도 (`LP_PA_CBND_BUBUN`)

> 네이버 지도는 필지 폴리곤 **좌표**를 제공하지 않습니다. 지적편집도는 그림(래스터)이라
> 클릭·색칠이 안 되므로, 도형은 VWorld에서 받아 네이버 지도 위에 얹는 구조입니다.

## 실행

```bash
npm install
cp .env.example .env.local     # 키를 채웁니다 (없어도 실행됩니다)
npm run dev                    # http://localhost:3000
```

키가 하나도 없어도 샘플 필지 + OSM 지도로 모든 기능이 동작합니다.
헤더의 데이터 출처 표기가 **주황색(샘플)** 인지 **초록색(VWorld)** 인지로 현재 상태를 알 수 있습니다.

## 인증키 발급

| 키 | 용도 | 발급처 |
| --- | --- | --- |
| `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID` | 배경지도 | [NCP 콘솔](https://console.ncloud.com/naver-service/application) → Maps → Application 등록 → **Web Dynamic Map** 이용신청 |
| `VWORLD_KEY` | 실제 지적도 임포트 | [VWorld](https://www.vworld.kr) → 오픈API → 인증키 발급신청 (**데이터 API**) |

- NCP에서 **Web 서비스 URL** 에 `http://localhost:3000` 을 등록해야 지도가 뜹니다. 누락되면 화면에 안내 메시지가 나옵니다.
- 인증 파라미터 이름은 발급 시점에 따라 다릅니다. 신규 키는 `ncpKeyId`(기본값), 예전 키는 `ncpClientId` — `NEXT_PUBLIC_NAVER_KEY_PARAM` 으로 바꿉니다.
- VWorld 키는 서버 스크립트에서만 쓰이므로 브라우저로 노출되지 않습니다.

## 건물 정보 (건축물대장)

```powershell
$env:BLDRGST_KEY="키"
npm run import:bldrgst    # 지번별 표제부 조회 → public/parcels.json 병합
```

국토교통부 건축물대장 표제부(`BldRgstHubService/getBrTitleInfo`)를 **지번(본번/부번)으로 직접**
조회합니다. 공간조인이 필요 없어 건물–필지 대응이 정확합니다. 붙는 값:

- 주용도 + **다세대 / 다가구 / 연립 / 아파트 세부 유형** (`etcPurps` 에서 추출)
- **세대수 / 가구수 / 호수**
- 층수, 연면적, 사용승인일(노후도), 구조, 건폐율·용적률

주의할 점:

- data.go.kr 은 **초당** 요청 제한이 있습니다. `PER_SECOND` 오류는 재시도 대상이고
  일일 한도 초과만 중단 사유입니다. 요청 간격 120ms + 동시 2로 5,500건을 실패 없이 받습니다.
- 응답은 `data/bldrgst-cache.json` 에 저장돼 중단돼도 이어받습니다. 다시 받으려면 이 파일을 지우세요.
- VWorld 건물정보(`scripts/import-buildings.mjs`)도 남겨뒀지만 **용도 정확도가 떨어집니다**
  (표본 10건 중 9건이 대장과 불일치). 세대수도 없습니다. 건축물대장을 쓰세요.

## 현재 데이터 상태

`public/parcels.json` 은 **VWorld 연속지적도에서 받은 실제 논현동 필지 5,509개**입니다 (2025년 고시 기준).
필지마다 지번·지목·면적(폴리곤에서 계산)·개별공시지가가 들어 있고,
그중 **4,299필지에 건축물대장 정보**가 붙어 있습니다 (세대 14,421 + 가구 9,286 = 23,707).

주택 유형: 단독주택 809 · 공동주택 408 · 다가구주택 369 · 다세대주택 342 · 아파트 52 · 연립주택 36 · 다중주택 4

**구역은 비어 있는 상태(`data/zones.json` = `[]`)** 입니다. 관리자 모드에서 `+ 구역 추가` 로
직접 만들고 필지를 편입하세요.

### 성능

필지가 5천 개가 넘어 두 가지 처리를 합니다.

- `public/parcels.json` 을 **정적 파일로 분리**해 브라우저가 직접 받습니다. 서버 렌더링 페이로드에
  실었을 때 2.6MB였던 페이지 HTML이 13KB로 줄고, 필지 데이터는 브라우저 캐시를 탑니다.
- 지도에는 **화면 안에 들어온 필지만** 그립니다. 폴리곤 객체는 한 번 만들면 재사용하고,
  화면을 벗어나면 지도에서만 떼어냅니다. 구역 미지정 필지는 **줌 17 이상**에서만 표시합니다
  (`MIN_ZOOM_FOR_ALL`). 지도 우하단에 현재 그려진 필지 수가 표시됩니다.

## 실제 지적도로 교체

```powershell
$env:VWORLD_KEY="발급받은키"
npm run import:vworld    # 논현동(법정동 1168010800) 전 필지 → data/parcels.json, data/boundary.json
npm run reseed:zones     # 구역의 PNU 목록을 새 데이터에 맞춰 정리
```

`import:vworld` 는 논현동을 감싸는 BBOX로 페이지 단위 조회한 뒤 **PNU 접두사 `1168010800`** 으로
논현동 필지만 추려냅니다. 면적은 폴리곤에서 계산하고, 지목은 `jibun` 의 부호("38 대")를 풀어서 씁니다.

VWorld 응답의 함정 두 가지:

- `properties.bonbun` 이 `"26공"` 처럼 **지목이 붙어서** 옵니다. 그래서 본번/부번은 **PNU 문자열에서만** 잘라냅니다.
- 읍면동 경계(`LT_C_ADEMD_INFO`)는 꼭짓점 47개로 단순화돼 있어, 이걸로 필지를 자르면 가장자리 실제 지번이 100건 넘게 잘려나갑니다. 그래서 경계 폴리곤은 **표시용으로만** 쓰고 필터에는 쓰지 않습니다.

`reseed:zones` 는 이전 PNU를 버리고, 구역이 비면 `scripts/reseed-zones.mjs` 의 **예시 사각 범위**로 다시 채웁니다.
실제 구역계는 고시문을 보고 앱의 관리자 모드에서 편집하세요.

샘플 데이터로 되돌리려면 `npm run gen:parcels && npm run reseed:zones`.

## 화면 구성

| 영역 | 내용 |
| --- | --- |
| 좌측 패널 | 구역 목록(색·유형·단계·필지수·면적 합계), 지도 표시 토글, 지번 검색, 선택 필지 정보 |
| 지도 | 논현동 경계(점선) + 필지 폴리곤. 구역별 색으로 채워져 범위를 한눈에 확인 |
| 헤더 | 데이터 출처, 지도 유형(일반/위성/겹쳐보기), 지적편집도 토글, **관리자 모드** |
| 우상단 | 범례 / 좌하단 | 마우스를 올린 필지 정보 |

### 관리자 기능

1. 헤더의 **관리자 모드**를 켠다.
2. 지도에서 필지를 클릭해 선택한다. `Shift` / `Ctrl` 클릭으로 여러 필지를 한꺼번에 선택.
3. 좌측 **구역 편집**에서 대상 구역을 고르고 `구역에 편입` 또는 `구역에서 제외`.

한 필지는 하나의 구역에만 속합니다. 다른 구역의 필지를 편입하면 기존 구역에서 자동으로 빠집니다.
변경 사항은 `PATCH /api/zones` 를 거쳐 `data/zones.json` 에 저장되므로 새로고침해도 유지됩니다.

## API

```
GET    /api/zones                      → Zone[]
POST   /api/zones  { name, type, status, color }        구역 생성
DELETE /api/zones?zoneId=…                              구역 삭제
PATCH  /api/zones  { action: "add" | "remove", zoneId, pnus: string[] }
PATCH  /api/zones  { action: "clear", zoneId }
                                       → 모두 갱신된 Zone[] 반환
```

## 데이터

| 파일 | 설명 |
| --- | --- |
| `public/parcels.json` | 필지 폴리곤 GeoJSON. `source` 필드에 출처 표기. 브라우저가 직접 받음 |
| `data/boundary.json` | 논현동 경계 폴리곤 |
| `data/zones.json` | 구역 정의 + 소속 필지 PNU 목록 (편집 대상) |

`properties` 스키마는 `lib/types.ts` 의 `ParcelProps` 참고:
`pnu`(고유 키) / `jibun` / `bonbun` / `bubun` / `address` / `area`(㎡) / `category` / `centroid`(`[lat, lng]`).

> 초기 `data/zones.json` 의 구역 3개(명칭·지정일·단계)는 **예시 값**입니다. 실제 고시 내용으로 교체하세요.

## 구조

```
app/
  layout.tsx, page.tsx        서버에서 필지·구역 데이터와 환경변수 주입
  api/zones/route.ts          구역 조회/편집 API
components/
  AppShell.tsx                상태 관리 (선택, 구역, 관리자 모드) + 지도 선택
  NaverMapView.tsx            네이버 지도 (키가 있을 때)
  MapView.tsx                 Leaflet 지도 (키가 없을 때 대체)
  Sidebar.tsx                 구역 목록 · 검색 · 선택 필지 · 편집 패널
lib/
  types.ts                    공용 타입
  store.ts                    data/*.json 읽기·쓰기
scripts/
  import-vworld.mjs           VWorld 지적도 임포트
  reseed-zones.mjs            필지 교체 후 구역 PNU 정리
  gen-parcels.mjs             샘플 필지 생성기 (키 없이 개발용)
```

## 배포 (Vercel)

이 앱은 정적 사이트가 아니다. API 라우트, 서버에서의 MongoDB 조회, 쿠키 인증이 있어
Node 런타임이 필요하다. GitHub Pages 로는 배포할 수 없다.

1. Vercel 에서 이 GitHub 저장소를 Import 한다 (프레임워크는 Next.js 로 자동 인식된다).
2. Environment Variables 에 아래를 넣는다. 로컬에서 쓰는 `atlas-credentials.env` 는
   저장소에 올라가지 않으므로 `MONGODB_URI` 는 반드시 여기에 넣어야 한다.

   | 이름 | 설명 |
   | --- | --- |
   | `MONGODB_URI` | Atlas 접속 문자열 (비밀번호 포함) |
   | `MONGODB_DB` | 데이터베이스 이름 (기본 `nonhyun`) |
   | `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID` | 네이버 지도 Client ID |
   | `NEXT_PUBLIC_NAVER_KEY_PARAM` | `ncpKeyId` 또는 `ncpClientId` |

3. MongoDB Atlas → Network Access 에서 `0.0.0.0/0` 을 허용한다.
   Vercel 은 고정 IP 가 없어서 대역을 좁힐 수 없다.
4. 네이버 클라우드 콘솔 → Maps 애플리케이션의 "Web 서비스 URL" 에 배포 도메인
   (`https://<프로젝트>.vercel.app`)을 추가한다. 등록하지 않으면 지도가 인증 실패로 뜨지 않는다.
5. 첫 배포 후 관리자 계정이 없다면 로컬에서 한 번 넣어둔다.

   ```powershell
   $env:ADMIN_ID="아이디"; $env:ADMIN_PW="비밀번호"; npm run seed:admin
   ```

### 참고

- 구역·명부·관리자 계정은 모두 MongoDB(`nonhyun`)에 있다. 배포본과 로컬이 같은 DB 를 본다.
- `lib/consent.json`, `nonhyun.xlsx` 는 개인정보라 저장소에 올리지 않는다.
  명부를 갱신하려면 로컬에서 `npm run import:consent` → `npm run migrate:consent` 를 돌린다.
- 개발 서버를 켠 채로 프로덕션 빌드를 확인하려면 출력 폴더를 분리한다.

  ```bash
  NEXT_DIST_DIR=.next-build npm run build
  ```
