import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  primary:
    'border-brand-600 bg-brand-600 text-white shadow-sm hover:border-brand-700 hover:bg-brand-700',
  secondary:
    'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50',
  ghost: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  className = '',
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}
