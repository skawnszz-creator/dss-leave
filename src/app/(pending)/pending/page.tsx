import Link from "next/link";
import { redirect } from "next/navigation";

import { logoutAction } from "@/app/actions/auth";
import { requireSession } from "@/lib/auth/guards";

/** 처음 로그인한 사람: 휴가 관리자가 명단과 연결해 줄 때까지 기다린다 */
export default async function PendingPage() {
  const viewer = await requireSession();
  if (viewer.employee) redirect("/");

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-slate-200 bg-white px-6 py-8 text-center">
        <h1 className="text-lg font-semibold text-slate-900">관리자 확인을 기다리고 있습니다</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          {viewer.user.displayName} 님, 처음 오셨네요.
          <br />
          휴가 관리자가 직원 명단과 연결해 주면 바로 쓸 수 있습니다.
        </p>
        {viewer.isAdmin && (
          <Link
            href="/admin/employees?needLink=1"
            className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            직원 관리로 가서 내 계정 연결하기
          </Link>
        )}
        <form action={logoutAction}>
          <button type="submit" className="text-sm text-slate-500 underline-offset-2 hover:underline">
            로그아웃
          </button>
        </form>
      </div>
    </div>
  );
}
