/**
 * 화면에 보일 글자와 색. Tailwind 가 클래스를 찾을 수 있게 전부 글자 그대로 적는다.
 */
import type { LeaveType, RequestKind, RequestStatus } from "@/lib/db/schema";

export { LEAVE_TYPE_INFO } from "./rules";

/** 달력 칩 색 (휴가 종류별) */
export const TYPE_CHIP: Record<LeaveType, string> = {
  ANNUAL: "bg-sky-100 text-sky-900 border-sky-300",
  AM_HALF: "bg-teal-100 text-teal-900 border-teal-300",
  PM_HALF: "bg-teal-100 text-teal-900 border-teal-300",
  CONDOLENCE: "bg-violet-100 text-violet-900 border-violet-300",
  SICK: "bg-rose-100 text-rose-900 border-rose-300",
  RESERVE: "bg-lime-100 text-lime-900 border-lime-300",
  OTHER: "bg-slate-100 text-slate-800 border-slate-300",
};

/** 달력 칩의 짧은 이름 */
export const TYPE_SHORT: Record<LeaveType, string> = {
  ANNUAL: "연차",
  AM_HALF: "오전반차",
  PM_HALF: "오후반차",
  CONDOLENCE: "경조사",
  SICK: "건강검진",
  RESERVE: "예비군",
  OTHER: "기타",
};

export const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: "결재 중",
  APPROVED: "승인",
  REJECTED: "반려",
  WITHDRAWN: "신청 취소",
  CANCELED: "취소됨",
  SUPERSEDED: "변경됨",
};

export const STATUS_BADGE: Record<RequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900",
  APPROVED: "bg-emerald-100 text-emerald-900",
  REJECTED: "bg-red-100 text-red-800",
  WITHDRAWN: "bg-slate-100 text-slate-600",
  CANCELED: "bg-slate-100 text-slate-600",
  SUPERSEDED: "bg-slate-100 text-slate-600",
};

export const KIND_LABEL: Record<RequestKind, string> = {
  NEW: "휴가 신청",
  CHANGE: "날짜 변경",
  CANCEL: "취소 요청",
};

/** 1 → "1일", 0.5 → "0.5일", 2.5 → "2.5일" */
export function formatDays(n: number): string {
  const v = Math.round(n * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}일`;
}
