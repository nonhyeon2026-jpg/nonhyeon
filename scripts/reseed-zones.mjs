/**
 * 필지 데이터를 교체한 뒤 data/zones.json 의 PNU 목록을 새 데이터에 맞춘다.
 *
 *   1) 새 parcels.json 에 없는 PNU 는 제거한다 (샘플 → 실제 지적도 교체 시 전부 사라짐).
 *   2) 그 결과 비어버린 구역은 아래 SEED_RULES 의 사각 범위로 다시 채운다.
 *
 * ⚠️ SEED_RULES 의 범위는 시연용 예시입니다.
 *    실제 구역 경계는 고시문의 구역계를 확인해 앱의 관리자 모드에서 편집하세요.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SEED_RULES = {
  "nonhyun-1": { minLat: 37.5155, maxLat: 37.5196, minLng: 127.0225, maxLng: 127.0281 },
  "nonhyun-2": { minLat: 37.5108, maxLat: 37.5142, minLng: 127.0287, maxLng: 127.0338 },
  "nonhyun-3": { minLat: 37.5122, maxLat: 37.5152, minLng: 127.0206, maxLng: 127.0246 },
};

const parcels = JSON.parse(readFileSync(resolve(ROOT, "public/parcels.json"), "utf8"));
const zones = JSON.parse(readFileSync(resolve(ROOT, "data/zones.json"), "utf8"));

const known = new Set(parcels.features.map((f) => f.properties.pnu));
const taken = new Set();

for (const zone of zones) {
  const kept = zone.parcels.filter((p) => known.has(p));
  const dropped = zone.parcels.length - kept.length;
  zone.parcels = kept;
  kept.forEach((p) => taken.add(p));

  if (kept.length === 0) {
    const rule = SEED_RULES[zone.id];
    if (!rule) {
      console.log(`${zone.name}: 남은 필지 0개, 시드 규칙 없음 → 빈 구역으로 둡니다.`);
      continue;
    }
    const seeded = parcels.features
      .filter((f) => {
        const [lat, lng] = f.properties.centroid;
        return (
          lat >= rule.minLat &&
          lat <= rule.maxLat &&
          lng >= rule.minLng &&
          lng <= rule.maxLng &&
          !taken.has(f.properties.pnu)
        );
      })
      .map((f) => f.properties.pnu);
    seeded.forEach((p) => taken.add(p));
    zone.parcels = seeded;
    console.log(`${zone.name}: 무효 ${dropped}개 제거 → 예시 범위로 ${seeded.length}필지 재시드`);
  } else {
    console.log(`${zone.name}: 무효 ${dropped}개 제거, ${kept.length}필지 유지`);
  }
}

writeFileSync(resolve(ROOT, "data/zones.json"), JSON.stringify(zones, null, 2));
console.log("\ndata/zones.json 갱신 완료");
