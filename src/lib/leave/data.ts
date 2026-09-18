/**
 * 휴가 데이터 읽기. 계산 규칙은 rules.ts, 쓰기(신청·결재)는 workflow.ts 에 있다.
 */
import { and, asc, desc, eq, gt, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { EmployeeWithRank, Viewer } from "@/lib/auth/guards";
import { canSeeReason } from "@/lib/auth/guards";
import { todayKst } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { isUuid } from "@/lib/ids";
import {
  webApprovalSteps,
  webEmployees,
  webHolidays,
  webLeaveAdjustments,
  webLeaveRequests,
  webRanks,
  webTenureRules,
  type ApprovalStep,
  type Holiday,
  type LeaveRequest,
  type Rank,
} from "@/lib/db/schema";
import {
  balanceOn,
  expandLeaveDays,
  round1,
  type Balance,
  type LedgerInput,
  type TenureRuleRow,
} from "./rules";

type Q = typeof db | Tx;

/** 휴가로 '살아 있는' 신청: 새 신청·날짜 변경 중 승인됐거나 결재 중인 것 */
const LIVE_KINDS = ["NEW", "CHANGE"] as const;
const LIVE_STATUSES = ["APPROVED", "PENDING"] as const;

/* ------------------------------------------------------------------ */
/* 기준 정보                                                            */
/* ------------------------------------------------------------------ */

export async function loadHolidays(from?: string, to?: string): Promise<Holiday[]> {
  return db
    .select()
    .from(webHolidays)
    .where(
      and(
        eq(webHolidays.isDeleted, false),
        from ? gte(webHolidays.day, from) : undefined,
        to ? lte(webHolidays.day, to) : undefined,
      ),
    )
    .orderBy(asc(webHolidays.day));
}

export async function loadHolidaySet(): Promise<Set<string>> {
  const rows = await loadHolidays();
  return new Set(rows.map((h) => h.day));
}

export async function loadRules(): Promise<TenureRuleRow[]> {
  const rows = await db
    .select({
      fromYear: webTenureRules.fromYear,
      toYear: webTenureRules.toYear,
      days: webTenureRules.days,
    })
    .from(webTenureRules)
    .where(eq(webTenureRules.isDeleted, false))
    .orderBy(asc(webTenureRules.fromYear));
  return rows;
}

export async function loadRanks(): Promise<Rank[]> {
  return db
    .select()
    .from(webRanks)
    .where(eq(webRanks.isDeleted, false))
    .orderBy(asc(webRanks.sortOrder));
}

/* ------------------------------------------------------------------ */
/* 잔여 일수                                                            */
/* ------------------------------------------------------------------ */

export async function loadLedgerInput(
  employee: { id: string; hireDate: string },
  holidays: ReadonlySet<string>,
  rules: readonly TenureRuleRow[],
  opts: { excludeRequestIds?: string[]; q?: Q } = {},
): Promise<LedgerInput> {
  const q = opts.q ?? db;
  const exclude = opts.excludeRequestIds ?? [];

  const requests = await q
    .select()
    .from(webLeaveRequests)
    .where(
      and(
        eq(webLeaveRequests.employeeId, employee.id),
        eq(webLeaveRequests.isDeleted, false),
        eq(webLeaveRequests.deducts, true),
        inArray(webLeaveRequests.kind, [...LIVE_KINDS]),
        // 날짜 변경 신청은 승인되기 전까지 잔여에 넣지 않는다 (원래 휴가가 아직 살아 있다)
        or(
          eq(webLeaveRequests.status, "APPROVED"),
          and(eq(webLeaveRequests.status, "PENDING"), eq(webLeaveRequests.kind, "NEW")),
        ),
      ),
    );

  const adjustments = await q
    .select()
    .from(webLeaveAdjustments)
    .where(
      and(
        eq(webLeaveAdjustments.employeeId, employee.id),
        eq(webLeaveAdjustments.isDeleted, false),
      ),
    );

  const annualAdjust = new Map<number, number>();
  let monthlyAdjust = 0;
  for (const a of adjustments) {
    if (a.bucket === "ANNUAL" && a.year != null) {
      annualAdjust.set(a.year, round1((annualAdjust.get(a.year) ?? 0) + a.days));
    } else if (a.bucket === "MONTHLY") {
      monthlyAdjust = round1(monthlyAdjust + a.days);
    }
  }

  return {
    hireDate: employee.hireDate,
    rules,
    annualAdjust,
    monthlyAdjust,
    days: requests
      .filter((r) => !exclude.includes(r.id))
      .flatMap((r) => expandLeaveDays(r, r.status === "PENDING", holidays)),
  };
}

/** 잔여 일수. on 을 주면 그날 기준 (예: 지난해 인쇄는 12월 31일 기준) */
export async function getBalance(
  employee: { id: string; hireDate: string },
  ctx?: { holidays: ReadonlySet<string>; rules: readonly TenureRuleRow[] },
  on?: string,
): Promise<Balance> {
  const holidays = ctx?.holidays ?? (await loadHolidaySet());
  const rules = ctx?.rules ?? (await loadRules());
  const input = await loadLedgerInput(employee, holidays, rules);
  return balanceOn(input, on ?? todayKst());
}

/* ------------------------------------------------------------------ */
/* 결재 순서                                                            */
/* ------------------------------------------------------------------ */

/**
 * 결재권자: 신청자보다 높은 직급 중 결재권이 있는 직급 (표시는 낮은 직급부터).
 * 순서 없이 모두 승인해야 확정된다.
 * 그 직급에 재직 중인 사람이 없으면 건너뛴다.
 * 대표처럼 위에 아무도 없으면 빈 배열 → 결재 없이 바로 등록.
 */
export async function approvalChainFor(
  applicant: Pick<EmployeeWithRank, "id" | "rank">,
  q: Q = db,
): Promise<Rank[]> {
  const ranks = await q
    .select()
    .from(webRanks)
    .where(
      and(
        eq(webRanks.isDeleted, false),
        eq(webRanks.canApprove, true),
        gt(webRanks.sortOrder, applicant.rank.sortOrder),
      ),
    )
    .orderBy(asc(webRanks.sortOrder));
  if (ranks.length === 0) return [];

  const staffed = await q
    .select({ rankId: webEmployees.rankId })
    .from(webEmployees)
    .where(
      and(
        eq(webEmployees.isDeleted, false),
        eq(webEmployees.isActive, true),
        ne(webEmployees.id, applicant.id),
        inArray(
          webEmployees.rankId,
          ranks.map((r) => r.id),
        ),
      ),
    );
  const staffedIds = new Set(staffed.map((s) => s.rankId));
  return ranks.filter((r) => staffedIds.has(r.id));
}

/* ------------------------------------------------------------------ */
/* 결재 단계 (진행 표시용)                                               */
/* ------------------------------------------------------------------ */

export type StepView = ApprovalStep & {
  rankName: string;
  decidedByName: string | null;
};

export async function stepsFor(requestIds: string[]): Promise<Map<string, StepView[]>> {
  const map = new Map<string, StepView[]>();
  if (requestIds.length === 0) return map;
  const decider = alias(webEmployees, "decider");
  const rows = await db
    .select({ step: webApprovalSteps, rankName: webRanks.name, decidedByName: decider.name })
    .from(webApprovalSteps)
    .innerJoin(webRanks, eq(webRanks.id, webApprovalSteps.rankId))
    .leftJoin(decider, eq(decider.id, webApprovalSteps.decidedByEmployeeId))
    .where(
      and(
        inArray(webApprovalSteps.requestId, requestIds),
        eq(webApprovalSteps.isDeleted, false),
      ),
    )
    .orderBy(asc(webApprovalSteps.stepNo));
  for (const r of rows) {
    const list = map.get(r.step.requestId) ?? [];
    list.push({ ...r.step, rankName: r.rankName, decidedByName: r.decidedByName });
    map.set(r.step.requestId, list);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* 달력                                                                 */
/* ------------------------------------------------------------------ */

export type CalendarEntry = {
  requestId: string;
  employeeId: string;
  employeeName: string;
  rankName: string;
  leaveType: LeaveRequest["leaveType"];
  kind: LeaveRequest["kind"];
  startDate: string;
  endDate: string;
  days: number;
  pending: boolean;
  /** 볼 권한이 없으면 null */
  reason: string | null;
  isMine: boolean;
};

/** 기간과 겹치는 휴가 (승인 + 결재 중). 사유는 권한이 있을 때만 싣는다 */
export async function calendarEntries(
  from: string,
  to: string,
  viewer: Viewer,
): Promise<CalendarEntry[]> {
  const rows = await db
    .select({ req: webLeaveRequests, name: webEmployees.name, rankName: webRanks.name, rankOrder: webRanks.sortOrder })
    .from(webLeaveRequests)
    .innerJoin(webEmployees, eq(webEmployees.id, webLeaveRequests.employeeId))
    .innerJoin(webRanks, eq(webRanks.id, webEmployees.rankId))
    .where(
      and(
        eq(webLeaveRequests.isDeleted, false),
        inArray(webLeaveRequests.kind, [...LIVE_KINDS]),
        inArray(webLeaveRequests.status, [...LIVE_STATUSES]),
        lte(webLeaveRequests.startDate, to),
        gte(webLeaveRequests.endDate, from),
      ),
    )
    .orderBy(desc(webRanks.sortOrder), asc(webEmployees.name), asc(webLeaveRequests.startDate));

  return rows.map((r) => ({
    requestId: r.req.id,
    employeeId: r.req.employeeId,
    employeeName: r.name,
    rankName: r.rankName,
    leaveType: r.req.leaveType,
    kind: r.req.kind,
    startDate: r.req.startDate,
    endDate: r.req.endDate,
    days: r.req.days,
    pending: r.req.status === "PENDING",
    reason: canSeeReason(viewer, r.req.employeeId) ? r.req.reason : null,
    isMine: viewer.employee?.id === r.req.employeeId,
  }));
}

/* ------------------------------------------------------------------ */
/* 신청 목록                                                            */
/* ------------------------------------------------------------------ */

export type RequestView = LeaveRequest & {
  steps: StepView[];
  target: LeaveRequest | null;
  /** 이 휴가를 대상으로 결재 중인 변경·취소 신청 */
  openFollowUp: LeaveRequest | null;
};

async function attach(requests: LeaveRequest[]): Promise<RequestView[]> {
  const ids = requests.map((r) => r.id);
  const targetIds = requests
    .map((r) => r.targetRequestId)
    .filter((x): x is string => Boolean(x));

  const [steps, targets, followUps] = await Promise.all([
    stepsFor(ids),
    targetIds.length
      ? db.select().from(webLeaveRequests).where(inArray(webLeaveRequests.id, targetIds))
      : Promise.resolve([] as LeaveRequest[]),
    ids.length
      ? db
          .select()
          .from(webLeaveRequests)
          .where(
            and(
              inArray(webLeaveRequests.targetRequestId, ids),
              eq(webLeaveRequests.status, "PENDING"),
              eq(webLeaveRequests.isDeleted, false),
            ),
          )
      : Promise.resolve([] as LeaveRequest[]),
  ]);

  const targetMap = new Map(targets.map((t) => [t.id, t]));
  const followMap = new Map(followUps.map((f) => [f.targetRequestId!, f]));

  return requests.map((r) => ({
    ...r,
    steps: steps.get(r.id) ?? [],
    target: r.targetRequestId ? targetMap.get(r.targetRequestId) ?? null : null,
    openFollowUp: followMap.get(r.id) ?? null,
  }));
}

/** 내 신청: 올해 1월 1일 이후 휴가 + 결재 중인 것 전부 */
export async function myRequests(employeeId: string, sinceYear: number): Promise<RequestView[]> {
  const rows = await db
    .select()
    .from(webLeaveRequests)
    .where(
      and(
        eq(webLeaveRequests.employeeId, employeeId),
        eq(webLeaveRequests.isDeleted, false),
        or(
          gte(webLeaveRequests.endDate, `${sinceYear}-01-01`),
          eq(webLeaveRequests.status, "PENDING"),
        ),
      ),
    )
    .orderBy(desc(webLeaveRequests.startDate), desc(webLeaveRequests.createdAt));
  return attach(rows);
}

/** 그해에 걸친 휴가 (새 신청·날짜 변경분). 인쇄용 — 날짜 순 */
export async function requestsInYear(employeeId: string, year: number): Promise<RequestView[]> {
  const rows = await db
    .select()
    .from(webLeaveRequests)
    .where(
      and(
        eq(webLeaveRequests.employeeId, employeeId),
        eq(webLeaveRequests.isDeleted, false),
        inArray(webLeaveRequests.kind, [...LIVE_KINDS]),
        lte(webLeaveRequests.startDate, `${year}-12-31`),
        gte(webLeaveRequests.endDate, `${year}-01-01`),
      ),
    )
    .orderBy(asc(webLeaveRequests.startDate), asc(webLeaveRequests.createdAt));
  return attach(rows);
}

export async function requestById(id: string): Promise<RequestView | null> {
  if (!isUuid(id)) return null;
  const rows = await db
    .select()
    .from(webLeaveRequests)
    .where(and(eq(webLeaveRequests.id, id), eq(webLeaveRequests.isDeleted, false)))
    .limit(1);
  if (!rows[0]) return null;
  return (await attach(rows))[0];
}

/* ------------------------------------------------------------------ */
/* 결재함                                                               */
/* ------------------------------------------------------------------ */

export type ApprovalItem = RequestView & {
  stepId: string;
  applicantName: string;
  applicantRank: string;
  applicantHireDate: string;
};

/** 내 직급의 승인을 기다리는 결재 (내 신청은 빼고) */
export async function pendingForApprover(viewer: Viewer): Promise<ApprovalItem[]> {
  if (!viewer.employee || !viewer.isApprover) return [];
  const rows = await db
    .select({
      stepId: webApprovalSteps.id,
      req: webLeaveRequests,
      applicantName: webEmployees.name,
      applicantRank: webRanks.name,
      applicantHireDate: webEmployees.hireDate,
    })
    .from(webApprovalSteps)
    .innerJoin(webLeaveRequests, eq(webLeaveRequests.id, webApprovalSteps.requestId))
    .innerJoin(webEmployees, eq(webEmployees.id, webLeaveRequests.employeeId))
    .innerJoin(webRanks, eq(webRanks.id, webEmployees.rankId))
    .where(
      and(
        eq(webApprovalSteps.status, "PENDING"),
        eq(webApprovalSteps.isDeleted, false),
        eq(webApprovalSteps.rankId, viewer.employee.rankId),
        eq(webLeaveRequests.status, "PENDING"),
        eq(webLeaveRequests.isDeleted, false),
        ne(webLeaveRequests.employeeId, viewer.employee.id),
      ),
    )
    .orderBy(asc(webLeaveRequests.startDate));

  const views = await attach(rows.map((r) => r.req));
  return views.map((v, i) => ({
    ...v,
    stepId: rows[i].stepId,
    applicantName: rows[i].applicantName,
    applicantRank: rows[i].applicantRank,
    applicantHireDate: rows[i].applicantHireDate,
  }));
}

export async function pendingCountFor(viewer: Viewer): Promise<number> {
  if (!viewer.employee || !viewer.isApprover) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(webApprovalSteps)
    .innerJoin(webLeaveRequests, eq(webLeaveRequests.id, webApprovalSteps.requestId))
    .where(
      and(
        eq(webApprovalSteps.status, "PENDING"),
        eq(webApprovalSteps.isDeleted, false),
        eq(webApprovalSteps.rankId, viewer.employee.rankId),
        eq(webLeaveRequests.status, "PENDING"),
        eq(webLeaveRequests.isDeleted, false),
        ne(webLeaveRequests.employeeId, viewer.employee.id),
      ),
    );
  return row?.n ?? 0;
}

/** 내가 처리한 결재 (최근 순) */
export async function decidedBy(employeeId: string, limit = 30) {
  const applicant = alias(webEmployees, "applicant");
  return db
    .select({
      step: webApprovalSteps,
      req: webLeaveRequests,
      applicantName: applicant.name,
    })
    .from(webApprovalSteps)
    .innerJoin(webLeaveRequests, eq(webLeaveRequests.id, webApprovalSteps.requestId))
    .innerJoin(applicant, eq(applicant.id, webLeaveRequests.employeeId))
    .where(
      and(
        eq(webApprovalSteps.decidedByEmployeeId, employeeId),
        eq(webApprovalSteps.isDeleted, false),
      ),
    )
    .orderBy(desc(webApprovalSteps.decidedAt))
    .limit(limit);
}

/** 관리자 화면: 직원별 신청 (사유 없이) */
export async function requestsOfEmployee(employeeId: string): Promise<RequestView[]> {
  const rows = await db
    .select()
    .from(webLeaveRequests)
    .where(and(eq(webLeaveRequests.employeeId, employeeId), eq(webLeaveRequests.isDeleted, false)))
    .orderBy(desc(webLeaveRequests.startDate), desc(webLeaveRequests.createdAt))
    .limit(100);
  return attach(rows);
}

/** 겹침 검사용: 이 직원의 살아 있는 휴가 (승인 + 결재 중 + 결재 중인 변경) */
export async function liveSpansOf(employeeId: string, q: Q = db) {
  return q
    .select({
      id: webLeaveRequests.id,
      leaveType: webLeaveRequests.leaveType,
      startDate: webLeaveRequests.startDate,
      endDate: webLeaveRequests.endDate,
    })
    .from(webLeaveRequests)
    .where(
      and(
        eq(webLeaveRequests.employeeId, employeeId),
        eq(webLeaveRequests.isDeleted, false),
        inArray(webLeaveRequests.kind, [...LIVE_KINDS]),
        inArray(webLeaveRequests.status, [...LIVE_STATUSES]),
      ),
    );
}
