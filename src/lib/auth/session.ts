/**
 * 이 사이트의 세션을 읽고 쓰는 유일한 파일.
 *
 * 화면·API 곳곳에서 쿠키를 직접 읽지 않는다. 반드시 여기를 거친다.
 *
 * 서버 저장형이다 — 쿠키에는 랜덤 토큰 원문만 담고 DB 에는 그 sha256 만 둔다.
 * 이렇게 해야 퇴사자·문제 계정을 즉시 끊을 수 있다.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/lib/db";
import { webSessions, webUsers, type WebUser } from "@/lib/db/schema";
import { env } from "@/lib/env";

/** 이 사이트 고유 쿠키 이름. 포털의 dss_sso 나 다른 시스템 쿠키와 겹치지 않게 한다. */
export const SESSION_COOKIE = "leave_session";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.sessionHours * 60 * 60 * 1000);

  await db.insert(webSessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 사내망 HTTP 단계에서 켜면 쿠키가 저장되지 않아 로그인이 조용히 실패한다.
    secure: env.sessionCookieSecure,
    expires: expiresAt,
  });
}

/** 현재 요청의 로그인 계정. 없으면 null. */
export async function getSessionUser(): Promise<WebUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ user: webUsers })
    .from(webSessions)
    .innerJoin(webUsers, eq(webUsers.id, webSessions.userId))
    .where(
      and(
        eq(webSessions.tokenHash, hashToken(token)),
        gt(webSessions.expiresAt, new Date()),
        isNull(webSessions.revokedAt),
        eq(webUsers.isActive, true),
        eq(webUsers.isDeleted, false),
      ),
    )
    .limit(1);

  return rows[0]?.user ?? null;
}

/** 이 사이트의 세션만 끊는다. (포털 세션은 그대로) */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await db
      .update(webSessions)
      .set({ revokedAt: new Date() })
      .where(eq(webSessions.tokenHash, hashToken(token)));
  }

  store.delete(SESSION_COOKIE);
}
