"use server";

import { redirect } from "next/navigation";

import { writeAudit } from "@/lib/audit";
import { getViewer, safeReturnTo } from "@/lib/auth/guards";
import {
  devLoginEnabled,
  findDevUser,
  touchLogin,
  upsertDevMember,
} from "@/lib/auth/dev-login";
import { createSession, destroySession } from "@/lib/auth/session";

/* ------------------------------------------------------------------ */
/* 아래 두 개는 dss-auth OIDC 연결 시 폐기 대상                          */
/* ------------------------------------------------------------------ */

export async function devLoginAsAction(formData: FormData): Promise<void> {
  if (!devLoginEnabled()) redirect("/login");

  const userId = String(formData.get("userId") ?? "");
  const returnTo = safeReturnTo(String(formData.get("returnTo") ?? "/"));

  const user = await findDevUser(userId);
  if (!user || !user.isActive) redirect("/login?error=1");

  await touchLogin(user.id);
  await createSession(user.id);
  await writeAudit({
    actor: user,
    action: "LOGIN",
    summary: `${user.displayName} 로그인 (임시 로그인)`,
  });

  redirect(returnTo);
}

export async function devLoginNewAction(formData: FormData): Promise<void> {
  if (!devLoginEnabled()) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/login?error=1");

  const user = await upsertDevMember(name);
  await createSession(user.id);
  await writeAudit({
    actor: user,
    action: "LOGIN",
    summary: `${user.displayName} 로그인 (임시 로그인 · 처음 온 계정)`,
  });

  redirect("/");
}

/** 이 사이트의 세션만 끊는다. 포털까지 끊는 로그아웃은 OIDC 연결 때 추가한다 */
export async function logoutAction(): Promise<void> {
  const viewer = await getViewer();
  if (viewer) {
    await writeAudit({
      actor: viewer.user,
      action: "LOGOUT",
      summary: `${viewer.user.displayName} 로그아웃`,
    });
  }
  await destroySession();
  redirect("/login");
}
