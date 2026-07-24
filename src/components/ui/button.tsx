import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    const base =
      "inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors border";
    const styles =
      variant === "outline"
        ? "bg-white/70 text-gray-800 border-gray-300 hover:bg-gray-100"
        : "bg-gradient-to-r from-pink-300 to-amber-200 text-slate-900 border-pink-200 shadow hover:opacity-90";
    return (
      <button ref={ref} className={`${base} ${styles} ${className}`} {...props} />
    );
  }
);

Button.displayName = "Button";
