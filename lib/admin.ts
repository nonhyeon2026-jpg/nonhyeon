import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { ADMIN_COLLECTION, mongoDb } from "./mongo";

/**
 * 관리자 로그인. 계정과 쿠키 서명키는 MongoDB(nonhyun.admins)에 있다.
 *
 * 로그인하면 서명된 쿠키를 심고, 구역을 바꾸는 API 는 그 쿠키를 확인한다.
 * 화면에서 관리자 버튼을 숨기는 것만으로는 API 를 직접 부르는 것을 막지 못한다.
 */

export const ADMIN_COOKIE = "nonhyun_admin";
/** 로그인 유지 시간 (초) */
const MAX_AGE = 60 * 60 * 8;

/** _id 를 우리가 정한 문자열로 쓰므로 컬렉션 타입을 명시해야 한다 */
type AdminDoc = {
  _id: string;
  username?: string;
  salt?: string;
  hash?: string;
  sessionSecret?: string;
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

/** 아이디·비밀번호가 맞으면 쿠키에 넣을 토큰을 만든다 */
export async function login(username: string, password: string): Promise<string | null> {
  const col = await adminCollection();
  const user = await col.findOne({ _id: `user:${username}` });

  // 계정이 없어도 해시 계산을 한 번 돌려, 걸린 시간으로 계정 존재 여부가 드러나지 않게 한다
  const salt = user?.salt ?? randomBytes(16).toString("hex");
  const expected = Buffer.from(user?.hash ?? randomBytes(64).toString("hex"), "hex");
  const actual = scryptSync(password, salt, 64);
  const ok = Boolean(user) && expected.length === actual.length && timingSafeEqual(expected, actual);
  if (!ok) return null;

  const secret = await sessionSecret();
  const payload = `${username}.${Date.now() + MAX_AGE * 1000}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload, secret)}`;
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

  const [username, expiry] = payload.split(".");
  if (!username || Number(expiry) < Date.now()) return null;
  return username;
}

/** 지금 요청이 로그인된 관리자인지 */
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
