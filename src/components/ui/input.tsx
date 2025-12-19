import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => (
    <input
      ref={ref}
      className={`w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-pink-300 focus:ring-2 focus:ring-pink-100 ${className}`}
      {...props}
    />
  ),
);

Input.displayName = "Input";
