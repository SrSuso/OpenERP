import { useAuth } from '@/features/auth/useAuth';
import {
  POS_TERMINAL_SETTING_KEYS,
  SettingsOptionsPanel,
} from '@/features/settings/SettingsOptionsPanel';

/** `/admin/settings` — gated por `settings.read`/`settings.manage`
 * (`ADMIN` únicamente, ver la migración de la fase 21). Contiene sólo
 * ajustes funcionales de la tienda; infraestructura, credenciales y SMTP
 * pertenecen al entorno de los procesos. */
export function SettingsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('settings.manage');

  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold">Configuración</h1>
      <p className="mb-4 text-sm text-slate-500">
        Cada apartado se guarda por separado: cambia lo que necesites y pulsa «Guardar cambios» en
        esa tarjeta.
      </p>

      <SettingsOptionsPanel
        canManage={canManage}
        excludeKeys={[...POS_TERMINAL_SETTING_KEYS, 'catalog.sku_prefix']}
      />
    </section>
  );
}
