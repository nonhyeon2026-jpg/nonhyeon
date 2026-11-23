/**
 * 인터넷등기소 간편검색으로 지번마다 부동산고유번호를 모은다 (검색은 무료).
 *
 *   1) 워커용 크롬을 디버그 포트로 띄우고 로그인해 둔다 (한 번만, 프로필에 남는다)
 *      "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9333 --user-data-dir=D:\nonhyun\.iros-chrome
 *   2) node scripts/iros-pins.mjs [지번목록.txt] [--limit N]
 *
 * 입력: iros-out/jibuns.txt (한 줄에 지번 하나, 예: 138-9)
 * 출력: iros-out/pins.json  { "138-9": { at, total, rows: [{ pin, kind, display, status }] } }
 *       이미 받은 지번은 건너뛰므로 끊겨도 다시 돌리면 이어서 받는다.
 *       다시 받으려면 그 지번을 pins.json 에서 지우거나 파일을 지운다.
 *
 * 검색어는 "서울특별시 강남구 논현동 <지번>". 결과에는 같은 지번의 토지·건물·집합건물 호가
 * 모두 나오고, 비슷한 지번(138-9 → 138-90 등)이 섞일 수 있어 그대로 저장하고 대조는 나중에 한다.
 * 검색 사이에 5~8초 쉰다 (더 빠르면 "간편검색 서비스가 원활하지 않습니다"가 자주 뜬다).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const limitAt = args.indexOf("--limit");
const LIMIT = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;
const LIST = resolve(ROOT, args.find((a, i) => !a.startsWith("--") && (limitAt < 0 || i !== limitAt + 1)) || "iros-out/jibuns.txt");
const OUT = resolve(ROOT, "iros-out/pins.json");
const CDP = process.env.IROS_CDP || "http://127.0.0.1:9333";

const C = "#mf_wfm_potal_main_wfm_content_";
const GRID = C + "grd_smpl_srch_rslt";
const PAGER = C + "pgl_smpl_srch";

const BUSY = /원활하지|잠시 후/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => 5000 + Math.random() * 3000;

const jibuns = readFileSync(LIST, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const done = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
// 덜 받은 지번(쪽 넘김 실패)은 다시 받는다
const complete = (r) => r && r.rows.length >= r.total;
const todo = jibuns.filter((j) => !complete(done[j])).slice(0, LIMIT);
console.log(`지번 ${jibuns.length}개 · 받은 것 ${Object.keys(done).length} · 이번에 ${todo.length}`);

const browser = await chromium.connectOverCDP(CDP);
const page = browser.contexts()[0].pages().find((p) => p.url().includes("iros.go.kr")) || browser.contexts()[0].pages()[0];

/** WebSquare 처리중 덮개(#_modal)가 걷힐 때까지 */
async function idle(timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const busy = await page.evaluate(() => {
      const m = document.getElementById("_modal");
      return !!(m && m.offsetParent !== null && getComputedStyle(m).display !== "none" && getComputedStyle(m).visibility !== "hidden");
    }).catch(() => true);
    if (!busy) return;
    if (await page.locator("a:visible[id*='message_popup'][id$='btn_confirm1']").count()) return;
    await sleep(250);
  }
}

/** 떠 있는 안내창(확인 버튼)을 닫고 그 문구를 돌려준다 */
async function dismiss() {
  const btn = page.locator("a:visible[id*='message_popup'][id$='btn_confirm1']");
  if (!(await btn.count())) return null;
  const text = await page.locator("[id*='message_popup']:visible").first().innerText().catch(() => "");
  await btn.first().click();
  await sleep(400);
  return text.trim();
}

async function assertLogin() {
  const t = await page.evaluate(() => document.body.innerText.slice(0, 4000));
  if (/비회원 로그인|로그인\s*회원가입/.test(t) && !/로그아웃/.test(t)) {
    throw new Error("로그인이 풀렸습니다. 워커 크롬에서 다시 로그인한 뒤 다시 실행하세요.");
  }
}

/** 지금 그리드에 보이는 행 */
const readRows = () =>
  page.evaluate((grid) => {
    const g = document.querySelector(grid);
    if (!g) return [];
    return [...g.querySelectorAll("tbody tr")]
      .map((tr) => {
        const c = {};
        for (const td of tr.querySelectorAll("td[data-col_id]")) c[td.dataset.col_id] = td.innerText.trim();
        return c;
      })
      .filter((c) => Object.values(c).some((v) => /^\d{4}-\d{4}-\d{6}$/.test(v)));
  }, GRID);

const totalCount = () =>
  page.evaluate(() => {
    const m = document.body.innerText.match(/전체\s*([\d,]+)\s*건\s*\(/) || document.body.innerText.match(/전체\s*([\d,]+)\s*건/);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  });

function toRow(c) {
  const v = Object.values(c);
  const pin = v.find((x) => /^\d{4}-\d{4}-\d{6}$/.test(x));
  const kind = v.find((x) => /^(토지|건물|집합건물)$/.test(x)) || "";
  const status = v.find((x) => /^(현행|폐쇄|전산폐쇄)$/.test(x)) || "";
  const display = v.filter((x) => x !== pin && x !== kind && x !== status && /논현동|강남구/.test(x)).sort((a, b) => b.length - a.length)[0] || "";
  return { pin, kind, display, status };
}

async function openSearchPage() {
  await page.goto("https://www.iros.go.kr/index.jsp");
  await page.waitForSelector("#mf_wfm_potal_main_sch_realCorp___input", { timeout: 30000 });
  await assertLogin();
}

async function search(jibun) {
  const q = `서울특별시 강남구 논현동 ${jibun}`;
  // 결과 화면의 검색창은 fill 값이 내부 모델에 안 들어가 이전 결과가 남는다 → 늘 첫 화면에서 검색
  await openSearchPage();
  await page.waitForTimeout(2500); // WebSquare 초기화 전에 누르면 검색이 안 된다
  await page.click("#mf_wfm_potal_main_sch_realCorp___input");
  await page.fill("#mf_wfm_potal_main_sch_realCorp___input", q);
  await page.keyboard.press("Enter");
  // 결과 그리드나 안내창(혼잡·결과 없음) 중 먼저 뜨는 것
  try {
    await page.waitForSelector(`${GRID}:visible, a:visible[id*='message_popup'][id$='btn_confirm1']`, { timeout: 20000 });
  } catch (e) {
    // 등기가 없는 지번: 그리드 없이 "입력하신 검색조건에 대한 결과가 없습니다." 만 나온다
    const none = await page.evaluate(() => /검색조건에 대한 결과가 없습니다/.test(document.body.innerText)).catch(() => false);
    if (none) return { at: new Date().toISOString(), query: q, total: 0, message: "결과 없음", rows: [] };
    const where = await page.evaluate(() => location.href + " | " + document.title).catch(() => "?");
    await page.screenshot({ path: resolve(ROOT, "iros-out/last-error.png"), timeout: 5000 }).catch(() => {});
    throw new Error(`검색 결과 화면이 안 뜸 (${where})`);
  }
  // 결과(또는 결과 없음 안내)가 나올 때까지
  let before = Date.now();
  let msg = null;
  let busy = 0;
  let lastSig = "";
  let sigAt = Date.now();
  for (;;) {
    await sleep(500);
    await idle();
    msg = await dismiss();
    if (msg && /세션이 만료|로그인 페이지/.test(msg)) {
      throw new Error("로그인이 풀렸습니다 (세션 만료). 워커 크롬에서 다시 로그인한 뒤 다시 실행하세요.");
    }
    if (msg && BUSY.test(msg)) {
      // 혼잡 안내는 확인 누르고 곧바로 다시 검색하면 대개 된다 (오래 쉬는 것보다 낫다).
      // 첫 화면에서 넘어온 검색어가 이 화면 검색창에 이미 들어 있어 검색 버튼만 누르면 된다.
      if (++busy > 8) throw Object.assign(new Error(`간편검색 혼잡 ${busy - 1}회 연속`), { busy: true });
      await sleep(1000 + Math.random() * 1000);
      await page.click(C + "btn_smpl_srch").catch(() => {});
      before = Date.now();
      msg = null;
      continue;
    }
    if (msg) break;
    const rows = await readRows();
    const label = await page.evaluate(() => document.body.innerText.match(/조회결과가 없습니다/) !== null);
    if (rows.length && rows.some((r) => toRow(r).display.includes(jibun))) break;
    if (label && Date.now() - before > 3000) break;
    // 결과는 떴는데 이 지번이 없는 경우(비슷한 지번만 나옴 = 등기 없는 지번일 가능성) — 그대로 저장, 매칭에서 걸러진다
    const sig = rows.length ? toRow(rows[0]).pin + "|" + rows.length : "";
    if (sig && sig === lastSig && Date.now() - sigAt > 8000) break;
    if (sig !== lastSig) { lastSig = sig; sigAt = Date.now(); }
    if (Date.now() - before > 30000) throw new Error(`검색 응답 없음: ${jibun}`);
  }
  await sleep(500);
  const total = (await totalCount()) ?? 0;
  const seen = new Map();
  for (const r of (await readRows()).map(toRow)) seen.set(r.pin, r);
  // 다음 쪽: 쪽 번호는 몇 개씩 묶여 보인다. 보이면 그 번호를, 없으면 "다음 묶음"을 누른다
  const pages = Math.ceil(total / 10);
  for (let p = 2; p <= pages && seen.size < total; p++) {
    const firstBefore = JSON.stringify((await readRows())[0]);
    const turned = async () => {
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        const m = await dismiss(); // 쪽 넘김 중 혼잡 안내가 뜨면 닫고 다시 누른다
        if (m) return false;
        const first = JSON.stringify((await readRows())[0]);
        if (first && first !== firstBefore) return true;
      }
      return false;
    };
    for (let attempt = 0; attempt < 6; attempt++) {
      await idle();
      await dismiss();
      const label = page.locator(`${PAGER}_page_${p}`);
      // 쪽 번호가 보이면 그 번호, 안 보이면 다음 묶음. 재시도 때는 "다음 쪽" 버튼도 써 본다
      if (attempt % 2 === 1) await page.click(`${PAGER}_next_btn`).catch(() => {});
      else if (await label.isVisible().catch(() => false)) await label.click().catch(() => {});
      else await page.click(`${PAGER}_nextPage_btn`).catch(() => {});
      await idle();
      if (await turned()) break;
      await sleep(1000 + Math.random() * 1000);
    }
    for (const r of (await readRows()).map(toRow)) seen.set(r.pin, r);
    await sleep(1000 + Math.random() * 1000);
  }
  return { at: new Date().toISOString(), query: q, total, message: msg || undefined, rows: [...seen.values()] };
}

await openSearchPage();
let n = 0;
let busyStreak = 0;
for (const j of todo) {
  let ok = false;
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    try {
      const r = await search(j);
      // 쪽 넘김에서 빠진 쪽은 다시 돌릴 때 채워지도록 전에 받은 것과 합친다
      if (done[j]?.rows?.length) {
        const all = new Map(done[j].rows.map((x) => [x.pin, x]));
        for (const x of r.rows) all.set(x.pin, x);
        r.rows = [...all.values()];
      }
      done[j] = r;
      writeFileSync(OUT, JSON.stringify(done, null, 1));
      n++;
      ok = true;
      busyStreak = 0;
      const mine = r.rows.filter((x) => x.display.match(new RegExp(`논현동 ${j.replace("-", "\\-")}(?![\\d-])`)));
      console.log(`[${n}/${todo.length}] ${j}: 전체 ${r.total}건 · 받은 ${r.rows.length} · 이 지번 ${mine.length}${r.message ? " · " + r.message.replace(/\s+/g, " ").slice(0, 40) : ""}${r.rows.length < r.total ? " · ⚠ 덜 받음" : ""}`);
    } catch (e) {
      console.error(`✗ ${j} (${attempt}/3): ${e.message.split("\n")[0]}`);
      if (/로그인이 풀렸/.test(e.message)) process.exit(2);
      await dismiss().catch(() => {});
      if (e.busy) {
        busyStreak++;
        const wait = busyStreak >= 3 ? 120000 : 15000 * attempt; // 빠른 재시도로도 안 될 때만
        console.error(`   ${Math.round(wait / 1000)}초 쉼`);
        await sleep(wait);
      }
      await openSearchPage().catch(() => {});
    }
  }
  await sleep(jitter());
}
console.log(`끝: ${n}개 받음 → ${OUT}`);
const missing = jibuns.filter((j) => !complete(done[j]));
if (missing.length) console.log(`못 받은 지번 ${missing.length}개 — 다시 실행하면 이것만 받습니다: ${missing.slice(0, 20).join(", ")}`);
process.exit(0);
