import { promises as fs } from "node:fs";
import path from "node:path";
import { ZONE_COLLECTION, mongoDb } from "./mongo";
import type { Zone, ZoneMutation } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const BOUNDARY_PATH = path.join(DATA_DIR, "boundary.json");

/**
 * 구역 정보는 MongoDB(nonhyun.zones)에 있다. 필지 편입/제외가 곧 DB 갱신이다.
 *
 * 필지 데이터(public/parcels.json)는 서버를 거치지 않는다.
 * 2MB가 넘어 서버 렌더링 페이로드에 실으면 초기 로딩이 크게 느려지므로
 * 정적 파일로 두고 브라우저가 직접 받아 캐시한다.
 * 행정경계(data/boundary.json)도 바뀌지 않는 자료라 파일로 둔다.
 */

export async function readBoundary() {
  return JSON.parse(await fs.readFile(BOUNDARY_PATH, "utf8"));
}

/** DB 문서 → 화면이 쓰는 Zone. _id·order 는 내부용이라 내보내지 않는다 */
type ZoneDoc = Zone & { _id: string; order?: number };

const toZone = ({ _id, order, ...zone }: ZoneDoc): Zone => zone;

async function zonesCollection() {
  return (await mongoDb()).collection<ZoneDoc>(ZONE_COLLECTION);
}

export async function readZones(): Promise<Zone[]> {
  const col = await zonesCollection();
  const docs = await col.find({}).sort({ order: 1, _id: 1 }).toArray();
  return docs.map(toZone);
}

/**
 * 한 필지는 동시에 두 구역에 속할 수 없다 —
 * add 시 다른 구역에서는 자동으로 제거한다.
 */
export async function mutateZones(m: ZoneMutation): Promise<Zone[]> {
  const col = await zonesCollection();
  const target = await col.findOne({ _id: m.zoneId });
  if (!target) throw new Error(`알 수 없는 구역: ${m.zoneId}`);

  if (m.action === "setOwners") {
    if (!Number.isFinite(m.owners) || m.owners < 1) {
      throw new Error("소유자 수는 1 이상이어야 합니다");
    }
    await col.updateOne({ _id: m.zoneId }, { $set: { owners: Math.round(m.owners) } });
  } else if (m.action === "clear") {
    await col.updateOne({ _id: m.zoneId }, { $set: { parcels: [] } });
  } else if (m.action === "remove") {
    await col.updateOne({ _id: m.zoneId }, { $pullAll: { parcels: m.pnus } });
  } else {
    // 다른 구역에 있던 필지는 먼저 빼야 한 필지가 두 구역에 걸치지 않는다
    await col.updateMany({ _id: { $ne: m.zoneId } }, { $pullAll: { parcels: m.pnus } });
    await col.updateOne({ _id: m.zoneId }, { $addToSet: { parcels: { $each: m.pnus } } });
  }

  return readZones();
}

export async function createZone(input: Partial<Zone>): Promise<Zone[]> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new Error("구역 이름이 필요합니다");

  const col = await zonesCollection();
  if (await col.findOne({ name })) throw new Error("같은 이름의 구역이 이미 있습니다");

  const id = `zone-${Date.now().toString(36)}`;
  const last = await col.find({}).sort({ order: -1 }).limit(1).toArray();

  await col.insertOne({
    _id: id,
    id,
    name,
    type: String(input.type ?? "재개발"),
    status: String(input.status ?? "검토중"),
    color: /^#[0-9a-f]{6}$/i.test(String(input.color)) ? String(input.color) : "#ef4444",
    designatedAt: String(input.designatedAt ?? ""),
    note: String(input.note ?? ""),
    parcels: [],
    order: (last[0]?.order ?? -1) + 1,
  });

  return readZones();
}

export async function deleteZone(zoneId: string): Promise<Zone[]> {
  const col = await zonesCollection();
  const { deletedCount } = await col.deleteOne({ _id: zoneId });
  if (!deletedCount) throw new Error(`알 수 없는 구역: ${zoneId}`);
  return readZones();
}
