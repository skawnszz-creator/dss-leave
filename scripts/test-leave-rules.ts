/**
 * 휴가 규칙 검증 (DB 없이).  npm run test:leave
 *
 * 규칙을 고치면 여기 예시도 함께 고친다.
 */
import assert from "node:assert/strict";

import { addMonths, fullMonths, calendarWeeks } from "../src/lib/dates";
import {
  annualEntitlement,
  balanceOn,
  computeLeaveDays,
  monthlyAccruedOn,
  monthlyInfo,
  shortageIfAdded,
  spansOverlap,
  type LedgerInput,
} from "../src/lib/leave/rules";

const rules = [
  { fromYear: 1, toYear: 2, days: 10 },
  { fromYear: 3, toYear: 4, days: 11 },
];
const noHolidays = new Set<string>();

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

check("말일 처리: 1월 31일 + 1개월 = 2월 말일", () => {
  assert.equal(addMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
});

check("근속은 만 개월로 센다", () => {
  assert.equal(fullMonths("2024-03-04", "2027-01-01"), 33);
  assert.equal(fullMonths("2024-03-04", "2025-03-03"), 11);
  assert.equal(fullMonths("2024-03-04", "2025-03-04"), 12);
});

check("2024-03-04 입사 → 2027년은 만 2년 → 1~2년차 10일", () => {
  const e = annualEntitlement("2024-03-04", 2027, rules);
  assert.equal(e.tenureYears, 2);
  assert.equal(e.baseDays, 10);
  assert.equal(e.status, "OK");
});

check("2024-03-04 입사 → 2028년은 만 3년 → 3~4년차 11일", () => {
  const e = annualEntitlement("2024-03-04", 2028, rules);
  assert.equal(e.tenureYears, 3);
  assert.equal(e.baseDays, 11);
});

check("1월 1일에 만 1년이 안 되면 연차 대신 월차", () => {
  const e = annualEntitlement("2026-11-02", 2027, rules);
  assert.equal(e.status, "UNDER_ONE_YEAR");
  assert.equal(e.baseDays, 0);
});

check("근속 표에 없는 연차면 NO_RULE (관리자 확인)", () => {
  const e = annualEntitlement("2010-01-01", 2027, rules);
  assert.equal(e.status, "NO_RULE");
});

check("월차: 한 달마다 1일, 최대 11일, 1주년 전날까지", () => {
  const info = monthlyInfo("2026-11-02");
  assert.equal(info.accrualDates.length, 11);
  assert.equal(info.accrualDates[0], "2026-12-02");
  assert.equal(info.accrualDates[10], "2027-10-02");
  assert.equal(info.validUntil, "2027-11-01");
  assert.equal(monthlyAccruedOn(info, "2026-12-01"), 0);
  assert.equal(monthlyAccruedOn(info, "2027-01-02"), 2);
});

check("연차 일수: 주말·공휴일 제외", () => {
  const r1 = computeLeaveDays("ANNUAL", "2027-05-07", "2027-05-10", noHolidays);
  assert.ok(r1.ok && r1.days === 2);
  const r2 = computeLeaveDays("ANNUAL", "2027-05-03", "2027-05-07", new Set(["2027-05-05"]));
  assert.ok(r2.ok && r2.days === 4);
});

check("반차는 하루만, 휴일에는 불가", () => {
  const ok = computeLeaveDays("AM_HALF", "2027-05-06", "2027-05-06", noHolidays);
  assert.ok(ok.ok && ok.days === 0.5);
  assert.equal(computeLeaveDays("PM_HALF", "2027-05-08", "2027-05-08", noHolidays).ok, false);
  assert.equal(computeLeaveDays("PM_HALF", "2027-05-06", "2027-05-07", noHolidays).ok, false);
});

const newbie = (days: LedgerInput["days"], adjust: [number, number][] = []): LedgerInput => ({
  hireDate: "2026-11-02",
  rules,
  annualAdjust: new Map(adjust),
  monthlyAdjust: 0,
  days,
});

check("월차는 해가 바뀌어도 쓸 수 있다 (2026년에 생긴 월차를 2027년에)", () => {
  const b = balanceOn(
    newbie([{ date: "2027-01-15", amount: 1, requestId: "a", pending: false }]),
    "2027-01-20",
  );
  assert.equal(b.monthly?.accrued, 2);
  assert.equal(b.monthly?.used, 1);
  assert.equal(b.monthly?.remaining, 1);
  assert.equal(b.shortTotal, 0);
});

check("생긴 월차보다 많이 쓰면 모자란다", () => {
  // 3/8~3/12 (5일). 3/8 까지 생긴 월차 4일
  const days = ["2027-03-08", "2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12"].map(
    (date) => ({ date, amount: 1, requestId: "b", pending: true }),
  );
  assert.equal(shortageIfAdded(newbie([]), days), 1);
});

check("먼저 사라질 주머니부터: 월차(6/30 만료)가 연차(12/31 만료)보다 먼저", () => {
  const input: LedgerInput = {
    hireDate: "2026-07-01",
    rules,
    annualAdjust: new Map([[2027, 5]]),
    monthlyAdjust: 0,
    days: [
      { date: "2027-03-02", amount: 1, requestId: "c", pending: false },
      { date: "2027-08-02", amount: 1, requestId: "d", pending: false },
    ],
  };
  const b = balanceOn(input, "2027-03-10");
  assert.equal(b.monthly?.used, 1); // 3/2 는 월차에서
  assert.equal(b.annual.used, 1); // 8/2 는 월차가 끝나 연차에서
  assert.equal(b.annual.total, 5);
});

check("못 쓴 연차는 다음 해로 넘어가지 않는다", () => {
  const input: LedgerInput = {
    hireDate: "2024-03-04",
    rules,
    annualAdjust: new Map(),
    monthlyAdjust: 0,
    days: [],
  };
  const b2027 = balanceOn(input, "2027-12-31");
  const b2028 = balanceOn(input, "2028-01-01");
  assert.equal(b2027.annual.remaining, 10);
  assert.equal(b2028.annual.remaining, 11); // 2027년 남은 10일은 더해지지 않는다
});

check("같은 날 오전 반차 + 오후 반차는 겹치지 않는다", () => {
  const am = { leaveType: "AM_HALF" as const, startDate: "2027-05-06", endDate: "2027-05-06" };
  const pm = { leaveType: "PM_HALF" as const, startDate: "2027-05-06", endDate: "2027-05-06" };
  const full = { leaveType: "ANNUAL" as const, startDate: "2027-05-05", endDate: "2027-05-07" };
  assert.equal(spansOverlap(am, pm), false);
  assert.equal(spansOverlap(am, full), true);
});

check("달력은 일요일부터 한 주씩", () => {
  const weeks = calendarWeeks("2027-01");
  assert.equal(weeks[0][0], "2026-12-27");
  assert.ok(weeks.every((w) => w.length === 7));
});

console.log(`\n${passed}개 통과`);
