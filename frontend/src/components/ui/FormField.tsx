import type { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
}

export function FormField({ label, htmlFor, children, hint, error }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && !error && <p className="mt-1.5 text-sm text-slate-500">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
