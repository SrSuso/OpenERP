import { useQuery } from '@tanstack/react-query';

import { healthQuery } from '@/features/health/api';

/** Placeholder home for the admin panel; the dashboards land in phase 16. */
export function AdminHomePage() {
  const { data, isPending, isError, error } = useQuery(healthQuery);

  return (
    <section>
      <h1 className="text-2xl font-semibold">Panel de administración</h1>
      <p className="mt-2 text-slate-600">Fase 0: bootstrap. Los módulos se añaden por fases.</p>

      <dl className="mt-8 max-w-sm rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <dt className="font-medium text-slate-500">Estado de la API</dt>
        <dd className="mt-1" data-testid="api-status">
          {isPending && 'Comprobando…'}
          {isError && `Sin conexión (${error.message})`}
          {data && `${data.status} · ${data.app} · ${data.environment}`}
        </dd>
      </dl>
    </section>
  );
}
