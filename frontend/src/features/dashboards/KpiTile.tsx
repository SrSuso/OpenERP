interface KpiTileProps {
  value: string;
  /** Status colors are reserved for actual state, never decoration — pass
   * this only when the number itself represents a warning/critical
   * condition (e.g. low-stock count > 0). Always paired with `statusLabel`
   * text, never color alone. */
  status?: 'warning' | 'critical';
  statusLabel?: string;
}

const STATUS_COLOR: Record<'warning' | 'critical', string> = {
  warning: '#fab219',
  critical: '#d03b3b',
};

/** A single headline number — no chart earns its place for one measure
 * with no time/category dimension (see the dataviz "is it even a chart?"
 * check). Figures stay in the system sans, proportional (not tabular —
 * this is a standalone hero number, not a table column). */
export function KpiTile({ value, status, statusLabel }: KpiTileProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <p className="text-4xl font-bold text-slate-900">{value}</p>
      {status && statusLabel && (
        <p
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color: STATUS_COLOR[status] }}
        >
          <span aria-hidden="true">⚠</span>
          {statusLabel}
        </p>
      )}
    </div>
  );
}
