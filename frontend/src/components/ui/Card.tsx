import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}
