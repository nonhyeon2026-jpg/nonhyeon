import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { ADMIN_COLLECTION, mongoDb } from "./mongo";

/**
 * 관리자번호(4자리)로 앱에 들어간다. 번호의 해시와 쿠키 서명키는 MongoDB(nonhyun.admins)에 있다.
 *
 * 번호가 맞으면 서명된 쿠키를 심고, 화면과 데이터를 주는 API 는 모두 그 쿠키를 확인한다.
 * 4자리는 1만 가지뿐이라 마구 넣어 보면 금방 뚫린다 — 틀린 횟수를 세어 잠근다.
 */

export const ADMIN_COOKIE = "nonhyun_admin";
/** 쿠키 유지 시간 (초) */
const MAX_AGE = 60 * 60 * 24 * 7;
/** 변경 기록에 남는 이름. 계정이 따로 없어 모두 같은 이름이다 */
export const ADMIN_NAME = "관리자";

/** 같은 IP 에서 이만큼 틀리면 LOCK_MS 동안 막는다 */
const IP_FAILS = 5;
/** 어디서든 합쳐 이만큼 틀리면 LOCK_MS 동안 모두 막는다 — IP 를 바꿔 가며 넣는 것까지 */
const ALL_FAILS = 30;
const LOCK_MS = 15 * 60 * 1000;

/** _id 를 우리가 정한 문자열로 쓰므로 컬렉션 타입을 명시해야 한다 */
type AdminDoc = {
  _id: string;
  salt?: string;
  hash?: string;
  sessionSecret?: string;
  /** 잠금 계산용 — 창이 열린 뒤 틀린 횟수와 창이 닫히는 때 */
  fails?: number;
  until?: Date;
};

async function adminCollection() {
  return (await mongoDb()).collection<AdminDoc>(ADMIN_COLLECTION);
}

async function sessionSecret(): Promise<string> {
  const col = await adminCollection();
  const meta = await col.findOne({ _id: "meta:session" });
  if (!meta?.sessionSecret) {
    throw new Error("쿠키 서명키가 없습니다. npm run seed:admin 을 먼저 실행하세요.");
  }
  return meta.sessionSecret;
}

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("hex");

/** 지금 요청을 보낸 곳 (변경 기록과 같은 기준) */
export function clientIp(): string {
  const h = headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

const failKeys = (ip: string) => [
  { key: `fail:${ip}`, limit: IP_FAILS },
  { key: "fail:*", limit: ALL_FAILS },
];

/** 잠겨 있으면 풀리는 시각 */
async function lockedUntil(ip: string): Promise<Date | null> {
  const col = await adminCollection();
  const now = Date.now();
  for (const { key, limit } of failKeys(ip)) {
    const d = await col.findOne({ _id: key });
    if (d?.until && d.until.getTime() > now && (d.fails ?? 0) >= limit) return d.until;
  }
  return null;
}

/** 틀린 횟수 하나 더. 창이 지났으면 새로 센다 */
async function recordFail(ip: string) {
  const col = await adminCollection();
  const now = new Date();
  for (const { key } of failKeys(ip)) {
    const d = await col.findOne({ _id: key });
    if (!d?.until || d.until <= now) {
      await col.replaceOne(
        { _id: key },
        { fails: 1, until: new Date(now.getTime() + LOCK_MS) },
        { upsert: true },
      );
    } else {
      await col.updateOne({ _id: key }, { $inc: { fails: 1 } });
    }
  }
}

export type PinResult = { token: string } | { error: string; status: number };

/** 관리자번호가 맞으면 쿠키에 넣을 토큰을 만든다 */
export async function loginPin(pin: string): Promise<PinResult> {
  const ip = clientIp();
  const until = await lockedUntil(ip);
  if (until) {
    const min = Math.ceil((until.getTime() - Date.now()) / 60000);
    return { error: `여러 번 틀려 잠겼습니다. ${min}분 뒤에 다시 넣어 주세요.`, status: 429 };
  }

  const col = await adminCollection();
  const meta = await col.findOne({ _id: "meta:pin" });
  if (!meta?.salt || !meta.hash) {
    return { error: "관리자번호가 아직 정해지지 않았습니다 (npm run seed:admin).", status: 503 };
  }
  const expected = Buffer.from(meta.hash, "hex");
  const actual = scryptSync(pin, meta.salt, 64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await recordFail(ip);
    return { error: "관리자번호가 맞지 않습니다", status: 401 };
  }

  await col.deleteOne({ _id: `fail:${ip}` });
  const secret = await sessionSecret();
  const payload = `${ADMIN_NAME}.${Date.now() + MAX_AGE * 1000}`;
  return { token: `${Buffer.from(payload).toString("base64url")}.${sign(payload, secret)}` };
}

/** 토큰이 우리가 발급한 것이고 아직 안 지났는지 */
export async function verifyToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const secret = await sessionSecret();
  const expected = sign(payload, secret);
  if (
    expected.length !== signature.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  ) {
    return null;
  }

  const [name, expiry] = payload.split(".");
  if (!name || Number(expiry) < Date.now()) return null;
  return name;
}

/** 지금 요청이 관리자번호로 들어온 사람인지 */
export async function currentAdmin(): Promise<string | null> {
  return verifyToken(cookies().get(ADMIN_COOKIE)?.value);
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
  secure: process.env.NODE_ENV === "production",
};
