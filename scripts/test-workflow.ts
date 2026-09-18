/**
 * 신청·결재 흐름 검증.  npm run test:workflow
 *
 * 반드시 테스트 전용 DB(dss_leave_test)에서만 돈다. 화면용 개발 DB 를 건드리지 않는다.
 * 테스트 DB 는 새로 만들어 `npm run seed:dev` 로 가짜 데이터를 넣은 상태여야 한다.
 *
 * 결재는 순서가 없다: 결재권자 모두에게 동시에 가고, 모두 승인하면 확정, 한 명이라도 반려하면 끝.
 */
import assert from "node:assert/strict";

process.loadEnvFile(".env.local");
if (!process.env.DATABASE_URL?.endsWith("/dss_leave_test")) {
  throw new Error("테스트 전용 DB(…/dss_leave_test)를 DATABASE_URL 로 지정해서 실행하세요.");
}

async function main() {
  const { db } = await import("../src/lib/db");
  const s = await import("../src/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { loadEmployee } = await import("../src/lib/auth/guards");
  const wf = await import("../src/lib/leave/workflow");
  const { getBalance } = await import("../src/lib/leave/data");

  type Member = import("../src/lib/auth/guards").Member;

  async function member(name: string): Promise<Member> {
    const [e] = await db.select().from(s.webEmployees).where(eq(s.webEmployees.name, name));
    const [user] = await db.select().from(s.webUsers).where(eq(s.webUsers.employeeId, e.id));
    const employee = (await loadEmployee(e.id))!;
    return { user, employee, isAdmin: user.role === "LEAVE_ADMIN", isApprover: employee.rank.canApprove };
  }

  async function reqOf(id: string) {
    const [r] = await db.select().from(s.webLeaveRequests).where(eq(s.webLeaveRequests.id, id));
    return r;
  }
  async function stepsOf(requestId: string) {
    return db.select().from(s.webApprovalSteps).where(eq(s.webApprovalSteps.requestId, requestId));
  }
  /** 이 사람 직급의 결재 단계 (상태 무관) */
  async function stepFor(requestId: string, who: Member) {
    const [st] = await db
      .select()
      .from(s.webApprovalSteps)
      .where(and(eq(s.webApprovalSteps.requestId, requestId), eq(s.webApprovalSteps.rankId, who.employee.rankId)));
    return st ?? null;
  }
  async function approveAll(requestId: string, order: Member[]) {
    for (const who of order) {
      const st = await stepFor(requestId, who);
      ok(await wf.decideStep(who, st!.id, true, ""));
    }
  }
  function ok<T extends { ok: boolean }>(r: T): asserts r is T & { ok: true } {
    if (!r.ok) throw new Error(`실패: ${JSON.stringify(r)}`);
  }

  const 사원 = await member("한도윤");
  const 대리 = await member("이준호");
  const 관리자 = await member("김서연");
  const 과장 = await member("정민재");
  const 부장 = await member("최동욱");
  const 대표 = await member("윤성호");

  let passed = 0;
  const step = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  };

  let newId = "";
  await step("사원 신청 → 과장·부장·대표 세 명에게 동시에 결재 대기", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "ANNUAL", startDate: "2026-11-02", endDate: "2026-11-03", reason: "테스트" });
    ok(r);
    newId = r.requestId!;
    const steps = await stepsOf(newId);
    assert.equal(steps.length, 3);
    assert.ok(steps.every((x) => x.status === "PENDING"));
    assert.match(r.message, /과장·부장·대표 모두 승인하면 확정/);
    assert.equal((await reqOf(newId)).days, 2);
  });

  await step("대리는 결재할 수 없다", async () => {
    const st = await stepFor(newId, 과장);
    assert.equal((await wf.decideStep(대리, st!.id, true, "")).ok, false);
  });

  await step("다른 직급의 단계는 결재할 수 없다 (부장이 과장 단계를)", async () => {
    const st = await stepFor(newId, 과장);
    assert.equal((await wf.decideStep(부장, st!.id, true, "")).ok, false);
  });

  await step("순서 없음: 대표가 먼저 승인해도 된다. 한 명 승인으로는 아직 확정 아님", async () => {
    const st = await stepFor(newId, 대표);
    const r = await wf.decideStep(대표, st!.id, true, "");
    ok(r);
    assert.match(r.message, /과장·부장의 승인을 기다립니다/);
    assert.equal((await reqOf(newId)).status, "PENDING");
  });

  await step("반려는 사유가 있어야 한다", async () => {
    const st = await stepFor(newId, 과장);
    assert.equal((await wf.decideStep(과장, st!.id, false, "  ")).ok, false);
  });

  await step("남은 두 명이 동시에 승인해도 한 번만 확정된다", async () => {
    const [a, b] = await Promise.all([
      stepFor(newId, 과장).then((st) => wf.decideStep(과장, st!.id, true, "")),
      stepFor(newId, 부장).then((st) => wf.decideStep(부장, st!.id, true, "")),
    ]);
    ok(a);
    ok(b);
    const finishedCount = [a, b].filter((x) => x.code === "finished").length;
    assert.equal(finishedCount, 1);
    assert.equal((await reqOf(newId)).status, "APPROVED");
  });

  await step("같은 결재를 두 번 처리할 수 없다", async () => {
    const st = await stepFor(newId, 대표);
    assert.equal((await wf.decideStep(대표, st!.id, true, "")).ok, false);
  });

  await step("겹치는 날짜는 신청할 수 없다", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "AM_HALF", startDate: "2026-11-03", endDate: "2026-11-03", reason: "" });
    assert.equal(r.ok, false);
  });

  await step("남은 일수보다 많이 신청할 수 없다", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "ANNUAL", startDate: "2026-11-09", endDate: "2026-12-04", reason: "" });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /모자랍니다/);
  });

  let changeId = "";
  await step("결재 후 날짜 변경 → 모두 다시 결재, 그동안 원래 휴가 유지", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "ANNUAL", startDate: "2026-11-05", endDate: "2026-11-06", reason: "변경" }, newId);
    ok(r);
    changeId = r.requestId!;
    assert.equal((await reqOf(newId)).status, "APPROVED");
    assert.equal((await reqOf(changeId)).status, "PENDING");
  });

  await step("누구든 한 명이 반려하면 끝, 나머지 대기는 정리되고 원래 휴가 그대로", async () => {
    await approveAll(changeId, [과장]);
    const st = await stepFor(changeId, 부장);
    ok(await wf.decideStep(부장, st!.id, false, "그 주는 곤란"));
    assert.equal((await reqOf(changeId)).status, "REJECTED");
    const steps = await stepsOf(changeId);
    assert.ok(steps.every((x) => x.status !== "PENDING"));
    assert.equal((await reqOf(newId)).status, "APPROVED");
  });

  await step("변경이 모두 승인되면 원래 휴가는 '변경됨'", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "ANNUAL", startDate: "2026-11-05", endDate: "2026-11-06", reason: "변경2" }, newId);
    ok(r);
    changeId = r.requestId!;
    await approveAll(changeId, [부장, 대표, 과장]);
    assert.equal((await reqOf(newId)).status, "SUPERSEDED");
    assert.equal((await reqOf(changeId)).status, "APPROVED");
  });

  await step("결재 후 취소 → 모두 다시 승인 → 취소됨, 일수 돌려받음", async () => {
    const before = await getBalance(사원.employee);
    const r = await wf.submitCancel(사원, changeId, "일정 취소");
    ok(r);
    assert.equal((await reqOf(changeId)).status, "APPROVED"); // 승인 전까지 유지
    await approveAll(r.requestId!, [대표, 과장, 부장]);
    assert.equal((await reqOf(changeId)).status, "CANCELED");
    const after = await getBalance(사원.employee);
    assert.equal(after.annual.remaining, before.annual.remaining + 2);
  });

  await step("결재 전 신청은 거둬들일 수 있다 (일부 승인된 뒤라도)", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "PM_HALF", startDate: "2026-11-10", endDate: "2026-11-10", reason: "" });
    ok(r);
    await approveAll(r.requestId!, [과장]);
    ok(await wf.withdrawRequest(사원, r.requestId!));
    assert.equal((await reqOf(r.requestId!)).status, "WITHDRAWN");
    assert.ok((await stepsOf(r.requestId!)).every((x) => x.status !== "PENDING"));
  });

  await step("남의 신청은 거둬들일 수 없다", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "PM_HALF", startDate: "2026-11-11", endDate: "2026-11-11", reason: "" });
    ok(r);
    assert.equal((await wf.withdrawRequest(대리, r.requestId!)).ok, false);
    ok(await wf.withdrawRequest(사원, r.requestId!));
  });

  await step("과장 신청은 부장·대표만 결재 (자기 직급은 빠짐)", async () => {
    const r = await wf.submitLeave(과장, { leaveType: "ANNUAL", startDate: "2026-11-16", endDate: "2026-11-16", reason: "" });
    ok(r);
    assert.match(r.message, /부장·대표 모두 승인하면/);
    assert.equal((await stepsOf(r.requestId!)).length, 2);
    const st = await stepFor(r.requestId!, 부장);
    assert.equal((await wf.decideStep(과장, st!.id, true, "")).ok, false);
    ok(await wf.withdrawRequest(과장, r.requestId!));
  });

  await step("대표 신청은 결재 없이 바로 승인", async () => {
    const r = await wf.submitLeave(대표, { leaveType: "ANNUAL", startDate: "2026-11-20", endDate: "2026-11-20", reason: "" });
    ok(r);
    assert.equal((await reqOf(r.requestId!)).status, "APPROVED");
    assert.equal((await stepsOf(r.requestId!)).length, 0);
  });

  await step("관리자 정정: 휴가를 바로 취소 처리 (사유 필수)", async () => {
    const r = await wf.submitLeave(대리, { leaveType: "ANNUAL", startDate: "2026-11-23", endDate: "2026-11-23", reason: "" });
    ok(r);
    assert.equal((await wf.adminCancel(관리자, r.requestId!, "")).ok, false);
    assert.equal((await wf.adminCancel(대리, r.requestId!, "권한 없음")).ok, false);
    ok(await wf.adminCancel(관리자, r.requestId!, "잘못 신청"));
    assert.equal((await reqOf(r.requestId!)).status, "CANCELED");
  });

  await step("주말만 고르면 신청할 수 없다", async () => {
    const r = await wf.submitLeave(대리, { leaveType: "ANNUAL", startDate: "2026-11-21", endDate: "2026-11-22", reason: "" });
    assert.equal(r.ok, false);
  });

  await step("모양이 틀린 ID 는 DB 오류 대신 '찾을 수 없음'", async () => {
    assert.equal((await wf.withdrawRequest(사원, "not-a-uuid")).ok, false);
    assert.equal((await wf.decideStep(과장, "'; drop table x; --", true, "")).ok, false);
  });

  console.log(`\n${passed}개 통과`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
