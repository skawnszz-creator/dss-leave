/**
 * 권한 판정은 여기서만 한다.
 *
 * 클라이언트가 보낸 사용자 ID·역할·직원 ID 는 절대 믿지 않는다.
 * 항상 서버에서 세션을 검증해 얻은 값만 쓴다.
 * 화면에서 버튼을 숨기는 것은 UI 편의일 뿐이고, 실제 차단은 반드시 서버에서 한다.
 *
 * 역할
 * - 직원      : 명단에 연결된 계정
 * - 결재권자  : 직원 중 직급의 결재권이 켜진 사람 (과장·부장·대표)
 * - 휴가 관리자: web_users.role = LEAVE_ADMIN
 */
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import {
  webEmployees,
  webRanks,
  type Employee,
  type Rank,
  type WebUser,
} from "@/lib/db/schema";
import { getSessionUser } from "./session";

export type EmployeeWithRank = Employee & { rank: Rank };

export type Viewer = {
  user: WebUser;
  /** 명단에 연결되지 않았거나 퇴사 처리된 계정이면 null */
  employee: EmployeeWithRank | null;
  isAdmin: boolean;
  isApprover: boolean;
};

export type Member = Viewer & { employee: EmployeeWithRank };

/**
 * 로그인 후 돌아갈 주소를 안전하게 다듬는다.
 * '/'로 시작하고 '//'로 시작하지 않는 경로만 허용한다. 역슬래시가 섞인 값도 거절한다.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.includes("\\")) return "/";
  return value;
}

export async function loadEmployee(
  employeeId: string,
): Promise<EmployeeWithRank | null> {
  const rows = await db
    .select({ employee: webEmployees, rank: webRanks })
    .from(webEmployees)
    .innerJoin(webRanks, eq(webRanks.id, webEmployees.rankId))
    .where(
      and(
        eq(webEmployees.id, employeeId),
        eq(webEmployees.isDeleted, false),
        eq(webEmployees.isActive, true),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row.employee, rank: row.rank } : null;
}

/** 현재 요청의 사용자. 한 요청 안에서는 한 번만 읽는다. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const employee = user.employeeId ? await loadEmployee(user.employeeId) : null;
  return {
    user,
    employee,
    isAdmin: user.role === "LEAVE_ADMIN",
    isApprover: Boolean(employee?.rank.canApprove),
  };
});

/** 로그인 필수. 없으면 로그인 화면으로 보낸다. */
export async function requireSession(returnTo?: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    const target = safeReturnTo(returnTo);
    redirect(
      target === "/" ? "/login" : `/login?returnTo=${encodeURIComponent(target)}`,
    );
  }
  return viewer;
}

/**
 * 사내 화면에 들어올 수 있는가.
 * 명단에 연결되지 않은 계정은 '확인 대기' 화면으로 보낸다.
 * (단, 휴가 관리자는 명단 연결 전이라도 관리 화면을 쓸 수 있어야 한다)
 */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await requireSession();
  if (!viewer.employee && !viewer.isAdmin) redirect("/pending");
  return viewer;
}

/** 명단에 연결된 직원이어야 하는 화면 (신청·내 휴가) */
export async function requireMember(): Promise<Member> {
  const viewer = await requireSession();
  if (!viewer.employee) {
    redirect(viewer.isAdmin ? "/admin/employees?needLink=1" : "/pending");
  }
  return viewer as Member;
}

export async function requireApprover(): Promise<Member> {
  const member = await requireMember();
  if (!member.isApprover) redirect("/");
  return member;
}

export async function requireAdmin(): Promise<Viewer> {
  const viewer = await requireSession();
  if (!viewer.isAdmin) redirect("/");
  return viewer;
}

/** 휴가 사유를 볼 수 있는가: 본인과 결재권자만 (휴가 관리자라도 결재권이 없으면 못 본다) */
export function canSeeReason(viewer: Viewer, requestEmployeeId: string): boolean {
  return viewer.isApprover || viewer.employee?.id === requestEmployeeId;
}
