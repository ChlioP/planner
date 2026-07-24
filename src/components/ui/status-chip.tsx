import type { HTMLAttributes } from "react";

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const tones: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-pink-50 text-slate-700 ring-pink-200",
};

export function StatusChip({ tone = "neutral", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]} ${className}`} {...props} />;
}
