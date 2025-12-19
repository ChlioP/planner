import type { HTMLAttributes } from "react";

type ScrollAreaProps = HTMLAttributes<HTMLDivElement>;

export function ScrollArea({ className = "", ...props }: ScrollAreaProps) {
  return (
    <div className={`overflow-auto ${className}`} {...props} />
  );
}
