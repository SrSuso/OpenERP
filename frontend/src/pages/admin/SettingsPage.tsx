import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { SettingsOptionsPanel } from '@/features/settings/SettingsOptionsPanel';
import { SmtpSettingsForm } from '@/features/settings/SmtpSettingsForm';
import {
  smtpSettingsQuery,
  updateSmtpSettings,
  type SystemSettingsUpdate,
} from '@/features/settings/api';

/** `/admin/settings` — gated por `settings.read`/`settings.manage`
 * (`ADMIN` únicamente, ver la migración de la fase 21). Dos bloques muy
 * distintos: los ajustes de negocio del registro (que se pintan solos a
 * partir de `GET /settings/options`, ver `SettingsOptionsPanel`) y el
 * servidor SMTP saliente que usa `app.jobs.worker` — un cambio guardado
 * aquí se aplica en el siguiente sondeo del outbox, sin redepliegue
 * (backend/app/settings/service.py). */
export function SettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings.manage');
  const settings = useQuery(smtpSettingsQuery);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (payload: SystemSettingsUpdate) => updateSmtpSettings(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: smtpSettingsQuery.queryKey });
      setError(null);
      setSaved(true);
    },
    onError: () => {
      setSaved(false);
      setError('No se ha podido guardar la configuración.');
    },
  });

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Configuración</h1>
      <p className="mb-4 text-sm text-slate-500">
        Cada apartado se guarda por separado: cambia lo que necesites y pulsa «Guardar cambios» en
        esa tarjeta.
      </p>

      <SettingsOptionsPanel canManage={canManage} />

      <h2 className="mb-3 mt-8 text-lg font-semibold text-slate-800">Avanzado</h2>

      {settings.isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {settings.isError && (
        <p className="text-sm text-red-600">No se ha podido cargar la configuración.</p>
      )}
      {saved && <p className="mb-3 text-sm text-green-700">Configuración guardada.</p>}

      {settings.data && (
        <SmtpSettingsForm
          defaults={settings.data}
          isPending={saveMutation.isPending}
          submitError={error}
          onSubmit={(payload) => {
            setSaved(false);
            saveMutation.mutate(payload);
          }}
        />
      )}
    </section>
  );
}
