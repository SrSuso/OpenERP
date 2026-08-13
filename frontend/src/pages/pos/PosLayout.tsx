import { useState } from 'react';
import { Outlet } from 'react-router';

import { useAuth } from '@/features/auth/useAuth';
import { CloseTillDialog } from '@/features/pos/CloseTillDialog';
import { PosTerminalProvider } from '@/features/pos/PosTerminalProvider';
import { TerminalSelection } from '@/features/pos/TerminalSelection';
import { useLiveCatalog } from '@/features/pos/useLiveCatalog';
import { usePosTerminal } from '@/features/pos/usePosTerminal';
import { useShopSetting } from '@/features/settings/useShopSettings';

/**
 * Shell for `/pos`.
 *
 * Deliberately not the admin shell: the till is a full-screen, touch-first
 * surface with no sidebar navigation, so a cashier cannot wander into
 * administration by accident (and the backend would reject it anyway).
 */
export function PosLayout() {
  return (
    <PosTerminalProvider>
      <PosLayoutContent />
    </PosTerminalProvider>
  );
}

function PosLayoutContent() {
  const { user, logout } = useAuth();
  // Lo que se cambie en el panel se ve aquí sin recargar la caja.
  useLiveCatalog();
  const shopName = useShopSetting('app.display_name', 'OpenERP');
  // Nadie sale de la caja sin cuadrarla: el botón abre el cierre, y sólo
  // desde ahí —con la Z ya guardada— se cierra la sesión.
  const [closingTill, setClosingTill] = useState(false);
  const { selectedTerminal, selectionOpen, requestTerminalChange } = usePosTerminal();
  const warehouseId = selectedTerminal?.warehouse_id ?? null;

  if (selectionOpen) return <TerminalSelection />;

  return (
    <div className="pos-surface flex h-full flex-col bg-slate-900 text-slate-50">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <span className="text-xl font-semibold">{shopName} · TPV</span>
        <div className="flex items-center gap-4 text-sm">
          {user && <span>{user.full_name}</span>}
          {selectedTerminal && (
            <button
              type="button"
              onClick={requestTerminalChange}
              className="rounded border border-slate-600 px-3 py-2 hover:bg-slate-700"
            >
              {selectedTerminal.name}
            </button>
          )}
          <button
            type="button"
            onClick={() => setClosingTill(true)}
            className="rounded bg-slate-700 px-4 py-2 font-medium hover:bg-slate-600"
          >
            Cerrar sesión
          </button>
        </div>
      </header>
      <main key={selectedTerminal?.id} className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {closingTill && (
        <CloseTillDialog
          warehouseId={warehouseId}
          onCancel={() => setClosingTill(false)}
          onClosed={() => void logout()}
        />
      )}
    </div>
  );
}
