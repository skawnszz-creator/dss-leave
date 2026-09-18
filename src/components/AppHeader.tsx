import Link from "next/link";

import { logoutAction } from "@/app/actions/auth";
import type { Viewer } from "@/lib/auth/guards";
import { NavLink } from "./NavLink";

export function AppHeader({ viewer, pendingCount }: { viewer: Viewer; pendingCount: number }) {
  const { employee } = viewer;
  return (
    <header className="no-print border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <Link href="/" className="mr-2 flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-slate-900">휴가 관리</span>
          <span className="text-xs font-medium text-slate-400">DSS</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1">
          <NavLink href="/" exact>
            달력
          </NavLink>
          {employee && (
            <>
              <NavLink href="/leave/new">휴가 신청</NavLink>
              <NavLink href="/leave" exact>
                내 휴가
              </NavLink>
            </>
          )}
          {viewer.isApprover && (
            <NavLink href="/approvals">
              결재함
              {pendingCount > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          )}
          {viewer.isAdmin && (
            <>
              <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
              <NavLink href="/admin/employees">직원 관리</NavLink>
              <NavLink href="/admin/settings">휴가 설정</NavLink>
            </>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-sm text-slate-700">
            {employee ? employee.name : viewer.user.displayName}
            {employee && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                {employee.rank.name}
              </span>
            )}
            {viewer.isAdmin && (
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">
                휴가 관리자
              </span>
            )}
          </span>
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              로그아웃
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
