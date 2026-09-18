/**
 * 신청·결재 흐름 검증.  npm run test:workflow
 *
 * 반드시 테스트 전용 DB(dss_leave_test)에서만 돈다. 화면용 개발 DB 를 건드리지 않는다.
 * 테스트 DB 는 `npm run seed:dev` 로 가짜 데이터를 넣은 상태여야 한다.
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
    return {
      user,
      employee,
      isAdmin: user.role === "LEAVE_ADMIN",
      isApprover: employee.rank.canApprove,
    };
  }

  async function reqOf(id: string) {
    const [r] = await db.select().from(s.webLeaveRequests).where(eq(s.webLeaveRequests.id, id));
    return r;
  }
  async function pendingStep(requestId: string) {
    const [st] = await db
      .select()
      .from(s.webApprovalSteps)
      .where(and(eq(s.webApprovalSteps.requestId, requestId), eq(s.webApprovalSteps.status, "PENDING")));
    return st ?? null;
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
  await step("사원 신청 → 과장·부장·대표 3단계, 첫 단계 과장 차례", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "ANNUAL", startDate: "2026-11-02", endDate: "2026-11-03", reason: "테스트" });
    ok(r);
    newId = r.requestId!;
    const st = await pendingStep(newId);
    const [rank] = await db.select().from(s.webRanks).where(eq(s.webRanks.id, st!.rankId));
    assert.equal(rank.name, "과장");
    assert.equal((await reqOf(newId)).days, 2);
  });

  await step("대리는 결재할 수 없다", async () => {
    const st = await pendingStep(newId);
    const r = await wf.decideStep(대리, st!.id, true, "");
    assert.equal(r.ok, false);
  });

  await step("차례가 아닌 부장은 결재할 수 없다", async () => {
    const st = await pendingStep(newId);
    const r = await wf.decideStep(부장, st!.id, true, "");
    assert.equal(r.ok, false);
  });

  await step("반려는 사유가 있어야 한다", async () => {
    const st = await pendingStep(newId);
    const r = await wf.decideStep(과장, st!.id, false, "  ");
    assert.equal(r.ok, false);
  });

  await step("과장 → 부장 → 대표 차례로 승인하면 승인 완료", async () => {
    for (const who of [과장, 부장, 대표]) {
      const st = await pendingStep(newId);
      ok(await wf.decideStep(who, st!.id, true, ""));
    }
    assert.equal((await reqOf(newId)).status, "APPROVED");
  });

  await step("같은 결재를 두 번 처리할 수 없다", async () => {
    const [last] = await db
      .select()
      .from(s.webApprovalSteps)
      .where(and(eq(s.webApprovalSteps.requestId, newId), eq(s.webApprovalSteps.stepNo, 3)));
    const r = await wf.decideStep(대표, last.id, true, "");
    assert.equal(r.ok, false);
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
  await step("결재 후 날짜 변경 → 다시 결재, 그동안 원래 휴가 유지", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "ANNUAL", startDate: "2026-11-05", endDate: "2026-11-06", reason: "변경" }, newId);
    ok(r);
    changeId = r.requestId!;
    assert.equal((await reqOf(newId)).status, "APPROVED");
    assert.equal((await reqOf(changeId)).status, "PENDING");
  });

  await step("변경이 반려되면 원래 휴가가 그대로", async () => {
    const st = await pendingStep(changeId);
    ok(await wf.decideStep(과장, st!.id, false, "그 주는 곤란"));
    assert.equal((await reqOf(changeId)).status, "REJECTED");
    assert.equal((await reqOf(newId)).status, "APPROVED");
  });

  await step("변경이 끝까지 승인되면 원래 휴가는 '변경됨'", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "ANNUAL", startDate: "2026-11-05", endDate: "2026-11-06", reason: "변경2" }, newId);
    ok(r);
    changeId = r.requestId!;
    for (const who of [과장, 부장, 대표]) {
      const st = await pendingStep(changeId);
      ok(await wf.decideStep(who, st!.id, true, ""));
    }
    assert.equal((await reqOf(newId)).status, "SUPERSEDED");
    assert.equal((await reqOf(changeId)).status, "APPROVED");
  });

  await step("결재 후 취소 → 다시 결재 → 승인되면 취소됨", async () => {
    const before = await getBalance(사원.employee);
    const r = await wf.submitCancel(사원, changeId, "일정 취소");
    ok(r);
    assert.equal((await reqOf(changeId)).status, "APPROVED"); // 승인 전까지 유지
    for (const who of [과장, 부장, 대표]) {
      const st = await pendingStep(r.requestId!);
      ok(await wf.decideStep(who, st!.id, true, ""));
    }
    assert.equal((await reqOf(changeId)).status, "CANCELED");
    const after = await getBalance(사원.employee);
    assert.equal(after.annual.remaining, before.annual.remaining + 2);
  });

  await step("결재 전 신청은 거둬들일 수 있다", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "PM_HALF", startDate: "2026-11-10", endDate: "2026-11-10", reason: "" });
    ok(r);
    ok(await wf.withdrawRequest(사원, r.requestId!));
    assert.equal((await reqOf(r.requestId!)).status, "WITHDRAWN");
  });

  await step("남의 신청은 거둬들일 수 없다", async () => {
    const r = await wf.submitLeave(사원, { leaveType: "PM_HALF", startDate: "2026-11-11", endDate: "2026-11-11", reason: "" });
    ok(r);
    const w = await wf.withdrawRequest(대리, r.requestId!);
    assert.equal(w.ok, false);
    ok(await wf.withdrawRequest(사원, r.requestId!));
  });

  await step("과장 신청은 부장 → 대표 (자기 직급은 결재선에 없음)", async () => {
    const r = await wf.submitLeave(과장, { leaveType: "ANNUAL", startDate: "2026-11-16", endDate: "2026-11-16", reason: "" });
    ok(r);
    assert.match(r.message, /부장 → 대표/);
    const st = await pendingStep(r.requestId!);
    assert.equal((await wf.decideStep(과장, st!.id, true, "")).ok, false);
    ok(await wf.withdrawRequest(과장, r.requestId!));
  });

  await step("대표 신청은 결재 없이 바로 승인", async () => {
    const r = await wf.submitLeave(대표, { leaveType: "ANNUAL", startDate: "2026-11-20", endDate: "2026-11-20", reason: "" });
    ok(r);
    assert.equal((await reqOf(r.requestId!)).status, "APPROVED");
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
