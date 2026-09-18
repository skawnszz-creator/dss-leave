import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";

import { createEmployeeAction, linkUserAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth/guards";
import { formatTenure, todayKst } from "@/lib/dates";
import { db } from "@/lib/db";
import { webEmployees, webRanks, webUsers } from "@/lib/db/schema";
import { getBalance, loadHolidaySet, loadRanks, loadRules } from "@/lib/leave/data";
import { formatDays } from "@/lib/leave/labels";
import { tenureOn } from "@/lib/leave/rules";

const input =
  "rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdmin();
  const sp = await searchParams;
  const today = todayKst();

  const [rows, users, ranks, holidays, rules] = await Promise.all([
    db
      .select({ employee: webEmployees, rank: webRanks })
      .from(webEmployees)
      .innerJoin(webRanks, eq(webRanks.id, webEmployees.rankId))
      .where(eq(webEmployees.isDeleted, false))
      .orderBy(desc(webEmployees.isActive), desc(webRanks.sortOrder), asc(webEmployees.hireDate)),
    db.select().from(webUsers).where(eq(webUsers.isDeleted, false)),
    loadRanks(),
    loadHolidaySet(),
    loadRules(),
  ]);

  const pendingUsers = await db
    .select()
    .from(webUsers)
    .where(and(eq(webUsers.isDeleted, false), isNull(webUsers.employeeId)))
    .orderBy(desc(webUsers.lastLoginAt));

  const userByEmployee = new Map(users.filter((u) => u.employeeId).map((u) => [u.employeeId!, u]));
  const unlinkedEmployees = rows.filter((r) => r.employee.isActive && !userByEmployee.has(r.employee.id));

  const balances = new Map(
    await Promise.all(
      rows
        .filter((r) => r.employee.isActive)
        .map(async (r) => [r.employee.id, await getBalance(r.employee, { holidays, rules })] as const),
    ),
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">직원 관리</h1>
        <p className="mt-1 text-sm text-slate-500">
          입사일을 넣으면 근속 표에 따라 연차가 자동으로 정해집니다. 이름을 누르면 계산 내역과 조정 화면이 나옵니다.
        </p>
      </div>

      {sp.needLink === "1" && !viewer.employee && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          내 계정({viewer.user.displayName})이 아직 명단과 연결되지 않았습니다. 아래 &lsquo;확인 대기 계정&rsquo;에서 연결하세요.
        </p>
      )}

      {pendingUsers.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            확인 대기 계정 {pendingUsers.length}개
          </h2>
          <p className="mt-0.5 text-xs text-amber-800">
            처음 로그인한 사람입니다. 명단의 누구인지 연결해 주면 바로 쓸 수 있습니다.
          </p>
          <ul className="mt-3 space-y-2">
            {pendingUsers.map((u) => (
              <li key={u.id} className="rounded-md bg-white px-3 py-2">
                <ActionForm action={linkUserAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <span className="min-w-24 text-sm font-medium text-slate-900">{u.displayName}</span>
                  <span className="text-xs text-slate-400">
                    {u.lastLoginAt ? `${u.lastLoginAt.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} 로그인` : ""}
                  </span>
                  <span className="text-slate-400">→</span>
                  <select name="employeeId" required defaultValue="" className={input}>
                    <option value="" disabled>
                      명단에서 고르기
                    </option>
                    {unlinkedEmployees.map(({ employee, rank }) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} ({rank.name})
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                  >
                    연결
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">이름</th>
              <th className="px-3 py-2 font-medium">직급</th>
              <th className="px-3 py-2 font-medium">입사일</th>
              <th className="px-3 py-2 font-medium">근속</th>
              <th className="px-3 py-2 text-right font-medium">올해 연차</th>
              <th className="px-3 py-2 text-right font-medium">사용·대기</th>
              <th className="px-3 py-2 text-right font-medium">남음</th>
              <th className="px-3 py-2 font-medium">월차</th>
              <th className="px-3 py-2 font-medium">로그인 계정</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ employee, rank }) => {
              const b = balances.get(employee.id);
              const user = userByEmployee.get(employee.id);
              const tenure = tenureOn(employee.hireDate, today);
              return (
                <tr key={employee.id} className={employee.isActive ? "" : "text-slate-400"}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/employees/${employee.id}`}
                      className="font-medium text-slate-900 underline-offset-2 hover:underline"
                    >
                      {employee.name}
                    </Link>
                    {!employee.isActive && <span className="ml-1 text-xs">(퇴사)</span>}
                  </td>
                  <td className="px-3 py-2">
                    {rank.name}
                    {rank.canApprove && <span className="ml-1 text-xs text-emerald-700">결재</span>}
                  </td>
                  <td className="px-3 py-2 tabular">{employee.hireDate}</td>
                  <td className="px-3 py-2 text-slate-600">{formatTenure(tenure.months)}</td>
                  {b ? (
                    <>
                      <td className="px-3 py-2 text-right tabular">
                        {b.annual.entitlement.status === "UNDER_ONE_YEAR" || b.annual.entitlement.status === "NOT_HIRED" ? (
                          <span className="text-xs text-slate-400">월차 대상</span>
                        ) : b.annual.entitlement.status === "NO_RULE" ? (
                          <span className="text-xs text-red-700">근속 표 없음</span>
                        ) : (
                          formatDays(b.annual.total)
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular text-slate-600">
                        {formatDays(b.annual.used)}
                        {b.annual.pending > 0 && ` + ${formatDays(b.annual.pending)}`}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular">{formatDays(b.annual.remaining)}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {b.monthly
                          ? `${formatDays(Math.max(0, b.monthly.remaining))} 남음 / ${formatDays(b.monthly.accrued + b.monthly.adjust)} 생김`
                          : "-"}
                      </td>
                    </>
                  ) : (
                    <td colSpan={4} className="px-3 py-2 text-xs">
                      -
                    </td>
                  )}
                  <td className="px-3 py-2 text-xs">
                    {user ? (
                      <span className="text-slate-600">
                        {user.displayName}
                        {user.role === "LEAVE_ADMIN" && (
                          <span className="ml-1 rounded bg-indigo-50 px-1 py-0.5 text-indigo-700">관리자</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-400">연결 안 됨</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">직원 추가</h2>
        <ActionForm action={createEmployeeAction} className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-600">
            이름
            <input name="name" required maxLength={40} className={`mt-1 block w-32 ${input}`} />
          </label>
          <label className="text-xs text-slate-600">
            직급
            <select name="rankId" required defaultValue="" className={`mt-1 block ${input}`}>
              <option value="" disabled>
                고르기
              </option>
              {ranks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            입사일
            <input name="hireDate" type="date" required className={`mt-1 block ${input}`} />
          </label>
          <label className="text-xs text-slate-600">
            메모
            <input name="note" maxLength={300} className={`mt-1 block w-56 ${input}`} />
          </label>
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            추가
          </button>
        </ActionForm>
      </section>
    </div>
  );
}
