import type { ReactNode } from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'error';

const TONE_STYLES: Record<AlertTone, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-950',
  error: 'border-red-200 bg-red-50 text-red-900',
};

export function Alert({ children, tone = 'info' }: { children: ReactNode; tone?: AlertTone }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-sm ${TONE_STYLES[tone]}`}
    >
      {children}
    </div>
  );
}
