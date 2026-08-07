import { Outlet } from 'react-router';

/**
 * Shell for `/pos`.
 *
 * Deliberately not the admin shell: the till is a full-screen, touch-first
 * surface with no sidebar navigation, so a cashier cannot wander into
 * administration by accident (and the backend would reject it anyway).
 */
export function PosLayout() {
  return (
    <div className="pos-surface flex h-full flex-col bg-slate-900 text-slate-50">
      <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <span className="text-xl font-semibold">OpenERP · TPV</span>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
