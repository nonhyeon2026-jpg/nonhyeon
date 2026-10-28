/**
 * 새 참여의향서 명부로 DB(nonhyun.consent)를 보강한다. 지우거나 갈아 끼우지 않는다.
 *
 *   npm run merge:consent -- <이전 명부.xlsx> <새 명부.xlsx>           # 바뀔 내용만 보여 준다
 *   npm run merge:consent -- <이전 명부.xlsx> <새 명부.xlsx> --write   # DB 에 쓴다
 *   예) npm run merge:consent -- nonhyun.xlsx "의향서 제출 최신본.xlsx" --write
 *
 * DB 는 이전 명부에서 들여온 뒤 관리자 화면에서 많이 고쳐져 있다(통건물 총 호수, 묶은 지번,
 * 뺀 호, 옮긴 지번 …). migrate:consent 처럼 통째로 덮으면 그 손질이 사라지므로, 여기서는
 * **이전 명부와 새 명부의 차이만** DB 위에 얹는다.
 *
 * - 새 명부에서 늘어난 호를 더한다. DB 에 이미 같은 호가 있으면 두지 않는다 ("B동 304호" ↔ "304호").
 *   이전 명부에 있던 호는 DB 에 없어도 다시 넣지 않는다 — 관리자가 뺀 것이다.
 * - 새 명부에 처음 나온 지번은 import:consent 와 같은 규칙으로 만든다. 이전 명부에 있었는데
 *   DB 에 없는 지번은 관리자가 뺀 것이라 건너뛴다.
 * - 새로 통건물 제출("-")이 붙은 지번은 통건물로 바꾼다.
 * - 새 명부의 성명으로 한 사람이 함께 낸 호를 unitGroups 로 묶는다 (이름은 저장하지 않는다).
 * - 고장 난 호 목록을 고친다: 예전 import 가 "303, 502호" 를 한 호로 넣은 것, 관리자 화면이
 *   "A동 201호" 를 "A동"·"201호" 로 쪼갠 것, 그 때문에 호 목록을 비우고 숫자만 넣은 것.
 * - 새 명부에서 빠진 호·지번은 알려만 주고 DB 에서 빼지 않는다.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { findUnit, namesInManyParcels, readRoster, splitUnits, unitKey } from "./roster.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CREDENTIALS = resolve(ROOT, "atlas-credentials.env");
const PARCELS = resolve(ROOT, "public/parcels.json");
const CACHE = resolve(ROOT, "data/bldrgst-cache.json");
const DB_NAME = process.env.MONGODB_DB || "nonhyun";
const COLLECTION = "consent";

/** KEY="value" / KEY=value 형태만 읽는 최소 파서 */
function readEnvFile(file) {
  const out = {};
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
  }
  return out;
}

function uri() {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
  const file = readEnvFile(CREDENTIALS);
  if (!file.MONGODB_URI) {
    throw new Error("MONGODB_URI 를 찾지 못했습니다 (환경변수 또는 atlas-credentials.env).");
  }
  if (file.MONGODB_URI.includes("<db_password>") && file.MONGODB_PASSWORD) {
    return file.MONGODB_URI.replace("<db_password>", encodeURIComponent(file.MONGODB_PASSWORD));
  }
  return file.MONGODB_URI;
}

/** 건축물대장 표제부(동별)에서 이 필지의 총 호수를 추정한다 (import-consent.mjs 와 같은 규칙) */
function totalUnitsFromRegister(records) {
  if (!records?.length) return null;
  let total = 0;
  for (const r of records) {
    const units = Math.max(Number(r.hoCnt) || 0, Number(r.hhldCnt) || 0, Number(r.fmlyCnt) || 0);
    total += units || 1;
  }
  return total;
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const [oldPath, newPath] = args.filter((a) => !a.startsWith("--"));
if (!oldPath || !newPath) {
  console.error("사용법: node scripts/merge-consent.mjs <이전 명부.xlsx> <새 명부.xlsx> [--write]");
  process.exit(1);
}

const before = readRoster(resolve(ROOT, oldPath));
const after = readRoster(resolve(ROOT, newPath));
const parcels = JSON.parse(readFileSync(PARCELS, "utf8"));
const cache = JSON.parse(readFileSync(CACHE, "utf8"));
const pnuOf = new Map(parcels.features.map((f) => [f.properties.jibun, f.properties.pnu]));

const dedupe = (list) => {
  const out = [];
  for (const u of list) if (!out.some((o) => unitKey(o) === unitKey(u))) out.push(u);
  return out;
};
/** 그 필지에 정말 있는 호처럼 보이는 표기만 ("몇 호??" 같은 메모는 뺀다) */
const looksLikeUnit = (u) => /\d|[A-Za-z]/.test(u) && !u.includes("?");

const client = new MongoClient(uri(), { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const col = client.db(DB_NAME).collection(COLLECTION);
  const docs = await col.find({}).toArray();

  // 딸림 지번(sharedPnus)도 대표 문서로 찾아가게 건다 — lib/consent.ts 의 expandShared 와 같다
  const byPnu = new Map(docs.map((d) => [d.pnu, d]));
  const owner = new Map(byPnu);
  for (const d of docs) for (const p of d.sharedPnus ?? []) if (!owner.has(p)) owner.set(p, d);

  /** pnu → 고칠 문서 (원본은 그대로 두고 사본에서 고친다) */
  const work = new Map();
  const notes = new Map();
  const note = (pnu, msg) => notes.set(pnu, [...(notes.get(pnu) ?? []), msg]);
  const created = [];
  const skipped = [];
  const unmatched = [];
  /** DB 를 바꾸지 않아도 눈으로 봐야 하는 것 (바뀌는 문서에만 붙는 notes 와 따로 둔다) */
  const warnings = [];

  for (const [jibun, e] of after) {
    const pnu = pnuOf.get(jibun);
    if (!pnu) {
      unmatched.push(e.label);
      continue;
    }
    const old = before.get(jibun);
    const base = owner.get(pnu);

    if (!base) {
      if (old) {
        skipped.push(`논현동 ${jibun} — 이전 명부에 있었는데 DB 에 없어 관리자가 뺀 것으로 보고 건너뜁니다`);
        continue;
      }
      const units = dedupe(e.units.filter(looksLikeUnit));
      const registered = totalUnitsFromRegister(cache[pnu]);
      const total = e.whole ? (registered ?? 1) : Math.max(units.length, registered ?? 1);
      const doc = {
        _id: pnu,
        pnu,
        jibun,
        label: e.label,
        total,
        submitted: e.whole ? total : units.length,
        units: e.whole ? [] : units,
        wholeBuilding: e.whole,
        totalEstimated: registered === null || registered < units.length,
        sharedPnus: [],
        unitGroups: [],
      };
      work.set(pnu, doc);
      created.push(pnu);
      note(pnu, e.whole ? `새 지번 — 통건물 제출 ${total}호` : `새 지번 — ${units.length}/${total}호`);
    }

    const target = work.get(base?.pnu ?? pnu) ?? { ...base, units: [...base.units] };
    work.set(target.pnu, target);
    const via = target.pnu !== pnu ? ` (논현동 ${jibun} 명부)` : "";

    if (!target.wholeBuilding) {
      // 관리자 화면이 "A동 201호" 를 쪼개 놓은 목록은 명부에서 다시 만든다
      if (target.units.some((u) => /^[가-힣A-Za-z]동$/.test(u))) {
        const rebuilt = dedupe(e.units.filter(looksLikeUnit));
        note(target.pnu, `쪼개진 호 목록 복구${via}: [${target.units.join(", ")}] → [${rebuilt.join(", ")}]`);
        target.units = rebuilt;
      }
      // 예전 import 가 한 칸 그대로 넣은 "303, 502호" 를 호마다 나눈다
      target.units = dedupe(
        target.units.flatMap((u) => {
          const parts = splitUnits(u);
          if (parts.length > 1) note(target.pnu, `"${u}" → ${parts.join(", ")} 로 나눔`);
          return parts;
        }),
      );
      // 쉼표 묶음이 망가져 호 목록을 비우고 숫자만 넣어 둔 필지는 명부의 호로 채운다
      if (!target.units.length && e.units.length && !base?.units?.length && base) {
        target.units = dedupe(e.units.filter(looksLikeUnit));
        note(target.pnu, `비어 있던 호 목록을 명부로 채움${via}: ${target.units.length}호 (전에는 ${base.submitted}/${base.total})`);
        const registered = totalUnitsFromRegister(cache[target.pnu]);
        target.total = Math.max(target.units.length, registered ?? 1);
      }
      // 새 명부에서 늘어난 호
      const absent = [];
      for (const u of e.units) {
        if (!looksLikeUnit(u)) continue;
        if (old && findUnit(old.units, u)) {
          // 관리자가 뺀 호일 수도, 예전 호 목록이 쪼개지며 잃은 호일 수도 있다 (177-21 나동 201·202·301호)
          if (!findUnit(target.units, u)) absent.push(u);
          continue;
        }
        const same = findUnit(target.units, u);
        if (same) {
          if (unitKey(same) !== unitKey(u)) note(target.pnu, `"${u}" 는 이미 있는 "${same}" 와 같은 호로 봄`);
          continue;
        }
        target.units.push(u);
        note(target.pnu, `+ ${u}${via}`);
      }
      if (absent.length) {
        warnings.push(
          `논현동 ${jibun}${via} — 두 명부에 다 있는데 DB 에 없는 호: ${absent.join(", ")}. 관리자가 뺀 게 아니면 관리자 화면에서 넣으세요`,
        );
      }
      // 호를 알 수 없는 줄("몇 호??")은 호로 넣지 않는다. 낸 사람이 빠지지 않게 알려 준다.
      // 관리자가 그 표기 그대로(172-4 "단독주택") 또는 "호수미상" 으로 넣어 둔 만큼은 세어져 있다
      const unknown = e.units.filter((u) => !looksLikeUnit(u));
      const marked = target.units.filter((u) => u.startsWith("호수미상") || !looksLikeUnit(u)).length;
      if (unknown.length > marked) {
        warnings.push(
          `논현동 ${jibun}${via} — 호를 알 수 없는 줄 ${unknown.length}건(${unknown.join(", ")}). 낸 사람으로 세려면 관리자 화면에서 "호수미상" 처럼 넣으세요`,
        );
      }
    }

    if (e.whole && !old?.whole && !target.wholeBuilding) {
      target.wholeBuilding = true;
      note(target.pnu, `통건물 제출로 바뀜${via}`);
    }

    // 한 사람이 함께 낸 호. 같은 문서에 걸린 다른 지번 명부의 묶음과 합친다
    if (!target.wholeBuilding) {
      const groups = (target._groups ??= []);
      for (const person of e.people) {
        const labels = [...new Set(person.map((u) => findUnit(target.units, u)).filter(Boolean))];
        if (labels.length > 1) groups.push(labels);
      }
    }

    // 이전 명부에 있다가 새 명부에서 빠진 호는 알려만 준다
    for (const u of old?.units ?? []) {
      if (looksLikeUnit(u) && !findUnit(e.units, u)) note(target.pnu, `새 명부에 없는 호 (DB 는 그대로): ${u}`);
    }
  }

  for (const [jibun, e] of before) {
    if (!after.has(jibun)) skipped.push(`논현동 ${jibun} (${e.label}) — 새 명부에 없습니다. DB 는 그대로 둡니다`);
  }

  /* ------------------------------ 정리 · 쓰기 ------------------------------ */

  const ops = [];
  let peopleBefore = 0;
  let peopleAfter = 0;
  const peopleOf = (d) => {
    if (d.wholeBuilding) return 1;
    const extra = (d.unitGroups ?? []).reduce((n, g) => n + g.length - 1, 0);
    return Math.max(Math.min(1, d.submitted), d.submitted - extra);
  };

  for (const [pnu, d] of work) {
    const groups = d._groups ?? [];
    delete d._groups;
    // 한 호가 두 묶음에 들지 않게 앞 묶음에 둔다 (lib/consent.ts 의 liveGroups 와 같다)
    const used = new Set();
    d.unitGroups = [];
    for (const g of d.wholeBuilding ? [] : groups) {
      const kept = g.filter((u) => !used.has(u) && d.units.includes(u));
      if (kept.length < 2) continue;
      for (const u of kept) used.add(u);
      d.unitGroups.push(kept);
    }
    if (d.wholeBuilding) {
      d.units = d.units ?? [];
      d.submitted = d.total;
    } else if (d.units.length) {
      if (d.units.length > d.total) {
        note(pnu, `총 호수 ${d.total} → ${d.units.length} (제출 호가 더 많음)`);
        d.total = d.units.length;
      }
      d.submitted = d.units.length;
    }

    const base = byPnu.get(pnu);
    const fields = ["units", "submitted", "total", "wholeBuilding", "unitGroups"];
    const changed = !base || fields.some((f) => JSON.stringify(base[f] ?? []) !== JSON.stringify(d[f] ?? []));
    if (!changed) continue;

    peopleBefore += base ? peopleOf(base) : 0;
    peopleAfter += peopleOf(d);
    if (d.unitGroups.length && JSON.stringify(base?.unitGroups ?? []) !== JSON.stringify(d.unitGroups)) {
      note(pnu, `한 사람 묶음: ${d.unitGroups.map((g) => g.join("·")).join(", ")}`);
    }

    const from = base ? `${base.submitted}/${base.total}호${base.wholeBuilding ? " 통" : ""}` : "없음";
    const to = `${d.submitted}/${d.total}호${d.wholeBuilding ? " 통" : ""} · ${peopleOf(d)}명`;
    console.log(`\n논현동 ${d.jibun}: ${from} → ${to}`);
    for (const n of notes.get(pnu) ?? []) console.log(`  ${n}`);

    ops.push(
      base
        ? {
            updateOne: {
              filter: { _id: base._id },
              update: { $set: Object.fromEntries(fields.map((f) => [f, d[f]])) },
            },
          }
        : { insertOne: { document: d } },
    );
  }

  console.log("\n──────────");
  for (const s of skipped) console.log(`· ${s}`);
  for (const w of warnings) console.log(`! ${w}`);
  if (unmatched.length) console.log(`· 지적도에서 못 찾은 주소 ${unmatched.length}건: ${unmatched.join(", ")}`);
  const many = namesInManyParcels(resolve(ROOT, newPath));
  if (many.length) {
    console.log(
      `· 같은 이름이 두 지번 이상에 나오는 경우 ${many.length}건 — 동명이인과 가릴 수 없어 계산에 쓰지 않았습니다`,
    );
  }
  console.log(
    `\n바뀌는 문서 ${ops.length}건 (새로 ${created.length}건) · 이 문서들의 낸 사람 ${peopleBefore} → ${peopleAfter}명`,
  );

  if (!write) {
    console.log("미리보기입니다. DB 에 쓰려면 --write 를 붙이세요.");
  } else if (ops.length) {
    const r = await col.bulkWrite(ops, { ordered: true });
    console.log(`${DB_NAME}.${COLLECTION}: 갱신 ${r.modifiedCount} · 추가 ${r.insertedCount}`);
  }
} finally {
  await client.close();
}
