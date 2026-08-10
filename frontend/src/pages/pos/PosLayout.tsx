import { Outlet } from 'react-router';

import { useAuth } from '@/features/auth/AuthContext';
import { useShopSetting } from '@/features/settings/useShopSettings';

/**
 * Shell for `/pos`.
 *
 * Deliberately not the admin shell: the till is a full-screen, touch-first
 * surface with no sidebar navigation, so a cashier cannot wander into
 * administration by accident (and the backend would reject it anyway).
 */
export function PosLayout() {
  const { user, logout } = useAuth();
  const shopName = useShopSetting('app.display_name', 'OpenERP');

  return (
    <div className="pos-surface flex h-full flex-col bg-slate-900 text-slate-50">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <span className="text-xl font-semibold">{shopName} · TPV</span>
        <div className="flex items-center gap-4 text-sm">
          {user && <span>{user.full_name}</span>}
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded bg-slate-700 px-4 py-2 font-medium hover:bg-slate-600"
          >
            Cerrar sesión
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
