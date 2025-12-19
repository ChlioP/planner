import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: CardProps) {
  return <div className={`border rounded-lg ${className}`} {...props} />;
}

export function CardHeader({ className = "", ...props }: CardProps) {
  return <div className={`mb-2 ${className}`} {...props} />;
}

export function CardTitle({ className = "", ...props }: CardProps) {
  return <h3 className={`font-semibold ${className}`} {...props} />;
}

export function CardContent({ className = "", ...props }: CardProps) {
  return <div className={className} {...props} />;
}
