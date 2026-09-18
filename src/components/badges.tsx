import type { LeaveRequest } from "@/lib/db/schema";
import type { StepView } from "@/lib/leave/data";
import {
  KIND_LABEL,
  LEAVE_TYPE_INFO,
  STATUS_BADGE,
  STATUS_LABEL,
  TYPE_CHIP,
} from "@/lib/leave/labels";

export function StatusBadge({ status }: { status: LeaveRequest["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function KindBadge({ kind }: { kind: LeaveRequest["kind"] }) {
  if (kind === "NEW") return null;
  return (
    <span className="inline-flex items-center rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600">
      {KIND_LABEL[kind]}
    </span>
  );
}

export function TypeChip({ type }: { type: LeaveRequest["leaveType"] }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${TYPE_CHIP[type]}`}
    >
      {LEAVE_TYPE_INFO[type].label}
    </span>
  );
}

/** 결재 진행 (순서 없음): 과장 ✓ · 부장 대기 · 대표 ✓ */
export function StepTrail({ steps }: { steps: StepView[] }) {
  if (steps.length === 0) {
    return <span className="text-xs text-slate-500">결재 없이 등록</span>;
  }
  return (
    <ul className="flex flex-wrap items-center gap-1 text-xs">
      <li className="mr-0.5 text-slate-400">결재</li>
      {steps.map((s) => (
        <li key={s.id}>
          <span
            title={
              s.decidedByName
                ? `${s.decidedByName}${s.comment ? ` — ${s.comment}` : ""}`
                : undefined
            }
            className={
              s.status === "APPROVED"
                ? "rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800"
                : s.status === "REJECTED"
                  ? "rounded bg-red-50 px-1.5 py-0.5 text-red-700"
                  : s.status === "PENDING"
                    ? "rounded bg-amber-50 px-1.5 py-0.5 text-amber-900 ring-1 ring-amber-300"
                    : "rounded px-1.5 py-0.5 text-slate-400"
            }
          >
            {s.rankName}
            {s.status === "APPROVED" && " ✓"}
            {s.status === "REJECTED" && " ✕"}
            {s.status === "PENDING" && " 대기"}
          </span>
        </li>
      ))}
    </ul>
  );
}
