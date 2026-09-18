"use client";

/** 브라우저 인쇄 창을 연다. 종이에는 이 버튼이 찍히지 않는다 (no-print) */
export function PrintButton({ label = "인쇄하기" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      🖨 {label}
    </button>
  );
}
