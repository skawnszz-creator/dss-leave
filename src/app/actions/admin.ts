"use server";

/**
 * 휴가 관리자 전용 액션. 모든 함수가 맨 먼저 requireAdmin() 을 부른다.
 * 삭제는 전부 소프트 삭제다.
 */
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import type { ActionState } from "@/lib/action-state";
import { writeAudit } from "@/lib/audit";
import { requireAdmin, type Viewer } from "@/lib/auth/guards";
import { isYmd } from "@/lib/dates";
import { db } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import {
  ADJUSTMENT_BUCKETS,
  HOLIDAY_KINDS,
  USER_ROLES,
  webEmployees,
  webHolidays,
  webLeaveAdjustments,
  webLeaveRequests,
  webRanks,
  webTenureRules,
  webUsers,
  type AdjustmentBucket,
  type HolidayKind,
  type UserRole,
} from "@/lib/db/schema";
import { loadHolidaySet } from "@/lib/leave/data";
import { LEAVE_TYPE_INFO, isWorkday, workdaysBetween } from "@/lib/leave/rules";

function text(formData: FormData, key: string, max = 200): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

/** 폼에서 온 ID. UUID 모양이 아니면 빈 문자열 (DB 오류 대신 '찾을 수 없음'으로 끝나게) */
function formId(formData: FormData, key: string): string {
  const value = text(formData, key, 64);
  return isUuid(value) ? value : "";
}

function int(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function done(message: string): ActionState {
  revalidatePath("/", "layout");
  return { ok: message };
}

function softDeleteBy(admin: Viewer, reason: string | null) {
  return {
    isDeleted: true,
    deletedAt: new Date(),
    deletedBy: admin.user.id,
    deleteReason: reason,
    updatedAt: new Date(),
  };
}

async function rankExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: webRanks.id })
    .from(webRanks)
    .where(and(eq(webRanks.id, id), eq(webRanks.isDeleted, false)))
    .limit(1);
  return Boolean(rows[0]);
}

/* ------------------------------------------------------------------ */
/* 직원 명단                                                            */
/* ------------------------------------------------------------------ */

export async function createEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const name = text(formData, "name", 40);
  const rankId = formId(formData, "rankId");
  const hireDate = text(formData, "hireDate");
  if (!name) return { error: "이름을 적어 주세요." };
  if (!(await rankExists(rankId))) return { error: "직급을 골라 주세요." };
  if (!isYmd(hireDate)) return { error: "입사일을 확인하세요." };

  const [created] = await db
    .insert(webEmployees)
    .values({ name, rankId, hireDate, note: text(formData, "note", 300) || null })
    .returning();
  await writeAudit({
    actor: admin.user,
    action: "EMPLOYEE_CREATE",
    summary: `직원 등록: ${name} (입사 ${hireDate})`,
    entityType: "employee",
    entityId: created.id,
  });
  return done(`${name} 님을 명단에 넣었습니다.`);
}

export async function updateEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const name = text(formData, "name", 40);
  const rankId = formId(formData, "rankId");
  const hireDate = text(formData, "hireDate");
  const isActive = formData.get("isActive") === "on";
  const note = text(formData, "note", 300) || null;
  if (!name) return { error: "이름을 적어 주세요." };
  if (!(await rankExists(rankId))) return { error: "직급을 골라 주세요." };
  if (!isYmd(hireDate)) return { error: "입사일을 확인하세요." };

  const [before] = await db
    .select()
    .from(webEmployees)
    .where(and(eq(webEmployees.id, id), eq(webEmployees.isDeleted, false)))
    .limit(1);
  if (!before) return { error: "직원을 찾을 수 없습니다." };

  await db
    .update(webEmployees)
    .set({ name, rankId, hireDate, isActive, note, updatedAt: new Date() })
    .where(eq(webEmployees.id, id));

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (before.name !== name) changes.name = { from: before.name, to: name };
  if (before.rankId !== rankId) changes.rankId = { from: before.rankId, to: rankId };
  if (before.hireDate !== hireDate) changes.hireDate = { from: before.hireDate, to: hireDate };
  if (before.isActive !== isActive) changes.isActive = { from: before.isActive, to: isActive };
  if (before.note !== note) changes.note = { from: before.note, to: note };

  await writeAudit({
    actor: admin.user,
    action: "EMPLOYEE_UPDATE",
    summary: `직원 수정: ${name}${changes.hireDate ? ` (입사일 ${before.hireDate} → ${hireDate})` : ""}`,
    entityType: "employee",
    entityId: id,
    changes,
  });
  return done("저장했습니다.");
}

/** 잘못 등록한 직원만 지운다. 휴가 기록이 있으면 '퇴사 처리'를 쓴다 */
export async function deleteEmployeeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const [emp] = await db
    .select()
    .from(webEmployees)
    .where(and(eq(webEmployees.id, id), eq(webEmployees.isDeleted, false)))
    .limit(1);
  if (!emp) return { error: "직원을 찾을 수 없습니다." };

  const [used] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(webLeaveRequests)
    .where(and(eq(webLeaveRequests.employeeId, id), eq(webLeaveRequests.isDeleted, false)));
  if ((used?.n ?? 0) > 0) {
    return { error: "휴가 기록이 있는 직원은 지울 수 없습니다. '재직 중' 체크를 풀어 퇴사 처리하세요." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(webUsers)
      .set({ employeeId: null, updatedAt: new Date() })
      .where(eq(webUsers.employeeId, id));
    await tx
      .update(webEmployees)
      .set(softDeleteBy(admin, "잘못 등록"))
      .where(eq(webEmployees.id, id));
  });
  await writeAudit({
    actor: admin.user,
    action: "EMPLOYEE_DELETE",
    summary: `직원 삭제(잘못 등록): ${emp.name}`,
    entityType: "employee",
    entityId: id,
  });
  return done(`${emp.name} 님을 명단에서 지웠습니다.`);
}

/* ------------------------------------------------------------------ */
/* 로그인 계정 ↔ 명단 연결, 역할                                          */
/* ------------------------------------------------------------------ */

export async function linkUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = formId(formData, "userId");
  const employeeId = formId(formData, "employeeId");

  const [user] = await db
    .select()
    .from(webUsers)
    .where(and(eq(webUsers.id, userId), eq(webUsers.isDeleted, false)))
    .limit(1);
  if (!user) return { error: "계정을 찾을 수 없습니다." };

  const [emp] = await db
    .select()
    .from(webEmployees)
    .where(
      and(eq(webEmployees.id, employeeId), eq(webEmployees.isDeleted, false), eq(webEmployees.isActive, true)),
    )
    .limit(1);
  if (!emp) return { error: "명단에서 직원을 골라 주세요." };

  const [taken] = await db
    .select({ id: webUsers.id })
    .from(webUsers)
    .where(and(eq(webUsers.employeeId, employeeId), eq(webUsers.isDeleted, false), ne(webUsers.id, userId)))
    .limit(1);
  if (taken) return { error: `${emp.name} 님은 이미 다른 계정과 연결되어 있습니다.` };

  await db
    .update(webUsers)
    .set({ employeeId, updatedAt: new Date() })
    .where(eq(webUsers.id, userId));
  await writeAudit({
    actor: admin.user,
    action: "USER_LINK",
    summary: `계정 연결: ${user.displayName} → 명단의 ${emp.name}`,
    entityType: "user",
    entityId: userId,
  });
  return done(`${user.displayName} 계정을 ${emp.name} 님과 연결했습니다.`);
}

export async function unlinkUserAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = formId(formData, "userId");
  const [user] = await db
    .select()
    .from(webUsers)
    .where(and(eq(webUsers.id, userId), eq(webUsers.isDeleted, false)))
    .limit(1);
  if (!user) return { error: "계정을 찾을 수 없습니다." };

  await db
    .update(webUsers)
    .set({ employeeId: null, updatedAt: new Date() })
    .where(eq(webUsers.id, userId));
  await writeAudit({
    actor: admin.user,
    action: "USER_UNLINK",
    summary: `계정 연결 해제: ${user.displayName}`,
    entityType: "user",
    entityId: userId,
  });
  return done("연결을 풀었습니다.");
}

export async function setRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const userId = formId(formData, "userId");
  const role = text(formData, "role") as UserRole;
  if (!(USER_ROLES as readonly string[]).includes(role)) return { error: "역할을 확인하세요." };

  const [user] = await db
    .select()
    .from(webUsers)
    .where(and(eq(webUsers.id, userId), eq(webUsers.isDeleted, false)))
    .limit(1);
  if (!user) return { error: "계정을 찾을 수 없습니다." };
  if (user.role === role) return { ok: "바뀐 것이 없습니다." };

  if (user.role === "LEAVE_ADMIN" && role !== "LEAVE_ADMIN") {
    const [others] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(webUsers)
      .where(
        and(
          eq(webUsers.role, "LEAVE_ADMIN"),
          eq(webUsers.isDeleted, false),
          eq(webUsers.isActive, true),
          ne(webUsers.id, userId),
        ),
      );
    if ((others?.n ?? 0) === 0) return { error: "휴가 관리자가 한 명도 없게 되어 바꿀 수 없습니다." };
  }

  await db.update(webUsers).set({ role, updatedAt: new Date() }).where(eq(webUsers.id, userId));
  await writeAudit({
    actor: admin.user,
    action: "USER_ROLE",
    summary: `역할 변경: ${user.displayName} ${user.role} → ${role}`,
    entityType: "user",
    entityId: userId,
  });
  return done(role === "LEAVE_ADMIN" ? "휴가 관리자로 지정했습니다." : "휴가 관리자에서 뺐습니다.");
}

/* ------------------------------------------------------------------ */
/* 일수 조정                                                            */
/* ------------------------------------------------------------------ */

export async function addAdjustmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const employeeId = formId(formData, "employeeId");
  const bucket = text(formData, "bucket") as AdjustmentBucket;
  const year = int(formData, "year");
  const days = Number(text(formData, "days"));
  const reason = text(formData, "reason", 300);

  if (!(ADJUSTMENT_BUCKETS as readonly string[]).includes(bucket)) return { error: "연차·월차 중 골라 주세요." };
  if (bucket === "ANNUAL" && (year == null || year < 2000 || year > 2100)) return { error: "연도를 확인하세요." };
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 30 || Math.round(days * 2) !== days * 2) {
    return { error: "일수는 0.5일 단위로, -30 ~ 30 사이로 적어 주세요. (빼려면 앞에 - )" };
  }
  if (!reason) return { error: "조정 사유를 적어 주세요." };

  const [emp] = await db
    .select()
    .from(webEmployees)
    .where(and(eq(webEmployees.id, employeeId), eq(webEmployees.isDeleted, false)))
    .limit(1);
  if (!emp) return { error: "직원을 찾을 수 없습니다." };

  const [created] = await db
    .insert(webLeaveAdjustments)
    .values({
      employeeId,
      bucket,
      year: bucket === "ANNUAL" ? year : null,
      days,
      reason,
      createdByUserId: admin.user.id,
    })
    .returning();
  await writeAudit({
    actor: admin.user,
    action: "ADJUSTMENT_CREATE",
    summary: `일수 조정: ${emp.name} ${bucket === "ANNUAL" ? `${year}년 연차` : "월차"} ${days > 0 ? "+" : ""}${days}일 — ${reason}`,
    entityType: "adjustment",
    entityId: created.id,
  });
  return done("조정했습니다.");
}

export async function deleteAdjustmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const [adj] = await db
    .select()
    .from(webLeaveAdjustments)
    .where(and(eq(webLeaveAdjustments.id, id), eq(webLeaveAdjustments.isDeleted, false)))
    .limit(1);
  if (!adj) return { error: "조정 기록을 찾을 수 없습니다." };

  await db
    .update(webLeaveAdjustments)
    .set(softDeleteBy(admin, "관리자 삭제"))
    .where(eq(webLeaveAdjustments.id, id));
  await writeAudit({
    actor: admin.user,
    action: "ADJUSTMENT_DELETE",
    summary: `일수 조정 삭제: ${adj.days}일 — ${adj.reason}`,
    entityType: "adjustment",
    entityId: id,
  });
  return done("조정을 지웠습니다.");
}

/* ------------------------------------------------------------------ */
/* 직급                                                                 */
/* ------------------------------------------------------------------ */

export async function saveRankAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const name = text(formData, "name", 20);
  const sortOrder = int(formData, "sortOrder");
  const canApprove = formData.get("canApprove") === "on";
  if (!name) return { error: "직급 이름을 적어 주세요." };
  if (sortOrder == null || sortOrder < 0 || sortOrder > 99) return { error: "순서는 0~99 사이 숫자로 적어 주세요." };

  const [dup] = await db
    .select({ id: webRanks.id })
    .from(webRanks)
    .where(and(eq(webRanks.name, name), eq(webRanks.isDeleted, false), id ? ne(webRanks.id, id) : undefined))
    .limit(1);
  if (dup) return { error: `'${name}' 직급이 이미 있습니다.` };

  if (id) {
    await db
      .update(webRanks)
      .set({ name, sortOrder, canApprove, updatedAt: new Date() })
      .where(and(eq(webRanks.id, id), eq(webRanks.isDeleted, false)));
    await writeAudit({
      actor: admin.user,
      action: "RANK_UPDATE",
      summary: `직급 수정: ${name} (순서 ${sortOrder}, 결재권 ${canApprove ? "있음" : "없음"})`,
      entityType: "rank",
      entityId: id,
    });
    return done("직급을 저장했습니다.");
  }

  const [created] = await db.insert(webRanks).values({ name, sortOrder, canApprove }).returning();
  await writeAudit({
    actor: admin.user,
    action: "RANK_CREATE",
    summary: `직급 추가: ${name} (순서 ${sortOrder}, 결재권 ${canApprove ? "있음" : "없음"})`,
    entityType: "rank",
    entityId: created.id,
  });
  return done(`'${name}' 직급을 추가했습니다.`);
}

export async function deleteRankAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const [inUse] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(webEmployees)
    .where(and(eq(webEmployees.rankId, id), eq(webEmployees.isDeleted, false)));
  if ((inUse?.n ?? 0) > 0) return { error: "이 직급의 직원이 있어 지울 수 없습니다." };

  const [rank] = await db
    .update(webRanks)
    .set(softDeleteBy(admin, "관리자 삭제"))
    .where(and(eq(webRanks.id, id), eq(webRanks.isDeleted, false)))
    .returning();
  if (!rank) return { error: "직급을 찾을 수 없습니다." };
  await writeAudit({
    actor: admin.user,
    action: "RANK_DELETE",
    summary: `직급 삭제: ${rank.name}`,
    entityType: "rank",
    entityId: id,
  });
  return done("직급을 지웠습니다.");
}

/* ------------------------------------------------------------------ */
/* 근속 연차별 일수                                                      */
/* ------------------------------------------------------------------ */

export async function saveTenureRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const fromYear = int(formData, "fromYear");
  const toYear = int(formData, "toYear");
  const days = Number(text(formData, "days"));
  if (fromYear == null || toYear == null || fromYear < 1 || toYear < fromYear || toYear > 60) {
    return { error: "근속 연차를 확인하세요. (1 이상, 앞 숫자 ≤ 뒤 숫자)" };
  }
  if (!Number.isFinite(days) || days < 0 || days > 60 || Math.round(days * 2) !== days * 2) {
    return { error: "일수는 0.5일 단위로 적어 주세요." };
  }

  const others = await db
    .select()
    .from(webTenureRules)
    .where(and(eq(webTenureRules.isDeleted, false), id ? ne(webTenureRules.id, id) : undefined));
  const clash = others.find((r) => r.fromYear <= toYear && fromYear <= r.toYear);
  if (clash) {
    return { error: `${clash.fromYear}~${clash.toYear}년차 줄과 겹칩니다.` };
  }

  if (id) {
    await db
      .update(webTenureRules)
      .set({ fromYear, toYear, days, updatedAt: new Date() })
      .where(and(eq(webTenureRules.id, id), eq(webTenureRules.isDeleted, false)));
    await writeAudit({
      actor: admin.user,
      action: "TENURE_RULE_UPDATE",
      summary: `근속 표 수정: ${fromYear}~${toYear}년차 ${days}일`,
      entityType: "tenure_rule",
      entityId: id,
    });
    return done("저장했습니다.");
  }

  const [created] = await db.insert(webTenureRules).values({ fromYear, toYear, days }).returning();
  await writeAudit({
    actor: admin.user,
    action: "TENURE_RULE_CREATE",
    summary: `근속 표 추가: ${fromYear}~${toYear}년차 ${days}일`,
    entityType: "tenure_rule",
    entityId: created.id,
  });
  return done(`${fromYear}~${toYear}년차 ${days}일을 추가했습니다.`);
}

export async function deleteTenureRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const [rule] = await db
    .update(webTenureRules)
    .set(softDeleteBy(admin, "관리자 삭제"))
    .where(and(eq(webTenureRules.id, id), eq(webTenureRules.isDeleted, false)))
    .returning();
  if (!rule) return { error: "찾을 수 없습니다." };
  await writeAudit({
    actor: admin.user,
    action: "TENURE_RULE_DELETE",
    summary: `근속 표 삭제: ${rule.fromYear}~${rule.toYear}년차 ${rule.days}일`,
    entityType: "tenure_rule",
    entityId: id,
  });
  return done("지웠습니다.");
}

/* ------------------------------------------------------------------ */
/* 공휴일 · 회사 휴무일                                                  */
/* ------------------------------------------------------------------ */

/**
 * 휴일을 넣거나 빼면, 그날을 걸친 휴가의 일수를 다시 센다.
 * (새로 쉬는 날로 정해진 날에 휴가를 냈다면 그날은 휴가에서 빠져야 한다)
 */
async function recomputeDaysAround(day: string): Promise<number> {
  const holidays = await loadHolidaySet();
  const rows = await db
    .select()
    .from(webLeaveRequests)
    .where(
      and(
        eq(webLeaveRequests.isDeleted, false),
        inArray(webLeaveRequests.status, ["APPROVED", "PENDING"]),
        lte(webLeaveRequests.startDate, day),
        gte(webLeaveRequests.endDate, day),
      ),
    );
  let changed = 0;
  for (const r of rows) {
    const n = LEAVE_TYPE_INFO[r.leaveType].halfDay
      ? isWorkday(r.startDate, holidays)
        ? 0.5
        : 0
      : workdaysBetween(r.startDate, r.endDate, holidays).length;
    if (n !== r.days) {
      await db
        .update(webLeaveRequests)
        .set({ days: n, updatedAt: new Date() })
        .where(eq(webLeaveRequests.id, r.id));
      changed += 1;
    }
  }
  return changed;
}

export async function createHolidayAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const day = text(formData, "day");
  const name = text(formData, "name", 40);
  const kind = text(formData, "kind") as HolidayKind;
  if (!isYmd(day)) return { error: "날짜를 확인하세요." };
  if (!name) return { error: "이름을 적어 주세요. (예: 창립기념일)" };
  if (!(HOLIDAY_KINDS as readonly string[]).includes(kind)) return { error: "종류를 골라 주세요." };

  const [dup] = await db
    .select({ id: webHolidays.id })
    .from(webHolidays)
    .where(and(eq(webHolidays.day, day), eq(webHolidays.isDeleted, false)))
    .limit(1);
  if (dup) return { error: "그날은 이미 휴일로 등록되어 있습니다." };

  const [created] = await db.insert(webHolidays).values({ day, name, kind }).returning();
  await writeAudit({
    actor: admin.user,
    action: "HOLIDAY_CREATE",
    summary: `휴일 추가: ${day} ${name}`,
    entityType: "holiday",
    entityId: created.id,
  });
  const changed = await recomputeDaysAround(day);
  return done(
    `${day} ${name}을(를) 추가했습니다.${changed ? ` 그날에 걸친 휴가 ${changed}건의 일수를 다시 셌습니다.` : ""}`,
  );
}

export async function deleteHolidayAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = formId(formData, "id");
  const [h] = await db
    .update(webHolidays)
    .set(softDeleteBy(admin, "관리자 삭제"))
    .where(and(eq(webHolidays.id, id), eq(webHolidays.isDeleted, false)))
    .returning();
  if (!h) return { error: "찾을 수 없습니다." };
  await writeAudit({
    actor: admin.user,
    action: "HOLIDAY_DELETE",
    summary: `휴일 삭제: ${h.day} ${h.name}`,
    entityType: "holiday",
    entityId: id,
  });
  const changed = await recomputeDaysAround(h.day);
  return done(`지웠습니다.${changed ? ` 그날에 걸친 휴가 ${changed}건의 일수를 다시 셌습니다.` : ""}`);
}
