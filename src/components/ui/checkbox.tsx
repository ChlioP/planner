import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  onCheckedChange?: (checked: boolean) => void;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = "", onCheckedChange, onChange, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={`h-4 w-4 accent-blue-500 ${className}`}
        onChange={(event) => {
          onCheckedChange?.(event.target.checked);
          onChange?.(event);
        }}
        {...props}
      />
    );
  }
);

Checkbox.displayName = "Checkbox";
