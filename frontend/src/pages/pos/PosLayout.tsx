import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router';

import { usePosAuth } from '@/features/auth/usePosAuth';
import { CloseTillDialog } from '@/features/pos/CloseTillDialog';
import { PosHeaderActionsProvider } from '@/features/pos/PosHeaderActions';
import { usePosHeaderActions } from '@/features/pos/PosHeaderActionsContext';
import { PosTerminalProvider } from '@/features/pos/PosTerminalProvider';
import { TerminalSelection } from '@/features/pos/TerminalSelection';
import { useLiveCatalog } from '@/features/pos/useLiveCatalog';
import { usePosTerminal } from '@/features/pos/usePosTerminal';
import { usePosAppearance } from '@/features/pos/usePosAppearance';
import { useButtonColors } from '@/features/settings/useButtonColors';
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
      <PosHeaderActionsProvider>
        <PosLayoutContent />
      </PosHeaderActionsProvider>
    </PosTerminalProvider>
  );
}

function PosLayoutContent() {
  const { user, logout, hasPermission } = usePosAuth();
  const { surfaceColor } = usePosAppearance();
  // El TPV tiene su propia familia de color para acciones de cobro. Este
  // hook ya conserva el contraste al convertir el color elegido en escala.
  useButtonColors();
  // Lo que se cambie en el panel se ve aquí sin recargar la caja.
  useLiveCatalog();
  const shopName = useShopSetting('app.display_name', 'OpenERP');
  const [closingTill, setClosingTill] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null);
  const { selectedTerminal, selectionOpen, requestTerminalChange } = usePosTerminal();
  const { newSaleAction } = usePosHeaderActions();
  const warehouseId = selectedTerminal?.warehouse_id ?? null;

  useEffect(() => {
    const syncFullscreenState = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement !== null) {
        await document.exitFullscreen?.();
      } else {
        await document.documentElement.requestFullscreen?.();
      }
    } catch {
      // El navegador puede bloquear la petición (por ejemplo, fuera de un
      // gesto del usuario). El TPV sigue siendo perfectamente utilizable.
    }
  }

  if (selectionOpen) return <TerminalSelection />;

  return (
    <div
      className="pos-surface flex h-full flex-col text-slate-50"
      style={{ backgroundColor: surfaceColor }}
    >
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-5">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-semibold">{shopName} · TPV</span>
          {newSaleAction && (
            <button
              type="button"
              disabled={newSaleAction.disabled}
              onClick={newSaleAction.onPress}
              className="min-h-14 rounded bg-slate-700 px-4 py-3 text-base font-medium hover:bg-slate-600 disabled:opacity-50"
            >
              Nueva venta
            </button>
          )}
          {hasPermission('return.manage') && (
            <Link
              to="/pos/returns"
              className="min-h-14 rounded bg-slate-700 px-4 py-3 text-base font-medium hover:bg-slate-600"
            >
              Devolución
            </Link>
          )}
          {hasPermission('sale.read') && (
            <Link
              to="/pos/tickets"
              className="min-h-14 rounded bg-slate-700 px-4 py-3 text-base font-medium hover:bg-slate-600"
            >
              Tickets
            </Link>
          )}
        </div>
        <div className="flex items-center gap-4 text-base">
          {user && <span>{user.full_name}</span>}
          {selectedTerminal && (
            <button
              type="button"
              onClick={requestTerminalChange}
              className="min-h-14 rounded border border-slate-600 px-4 py-3 hover:bg-slate-700"
            >
              {selectedTerminal.name}
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="min-h-14 rounded border border-slate-600 px-4 py-3 font-medium hover:bg-slate-700"
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
          </button>
          {hasPermission('sale.manage') && (
            <button
              type="button"
              onClick={() => setClosingTill(true)}
              className="min-h-14 rounded bg-slate-700 px-5 py-3 font-medium hover:bg-slate-600"
            >
              Cierre Z
            </button>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-14 rounded bg-slate-700 px-5 py-3 font-medium hover:bg-slate-600"
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
          onClosed={() => setClosingTill(false)}
        />
      )}
    </div>
  );
}
