"use client";

import { useActionState, type ReactNode } from "react";

import type { ActionState } from "@/lib/action-state";

/**
 * 서버 액션을 부르는 폼. 처리 중에는 입력을 잠그고, 결과 문구를 폼 아래에 보여 준다.
 * confirm 을 주면 보내기 전에 한 번 묻는다. (실수 방지일 뿐, 실제 차단은 서버에서)
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && (
        <p role="alert" className="basis-full text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="basis-full text-sm text-emerald-700">
          {state.ok}
        </p>
      )}
    </form>
  );
}
