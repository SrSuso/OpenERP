import { NavLink, Outlet } from 'react-router';

const tabClassName = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-4 py-2 text-sm font-medium ${
    isActive
      ? 'border-brand-700 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;

/** `/admin/inventory` — gated by `inventory.read` in routes.tsx; cada
 * pestaña gestiona su propia escritura por `inventory.manage`. */
export function InventoryPage() {
  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Inventario</h1>
      <nav className="mb-6 flex gap-2 border-b border-slate-200" aria-label="Inventario">
        <NavLink to="balances" className={tabClassName}>
          Saldos
        </NavLink>
        <NavLink to="movements" className={tabClassName}>
          Movimientos
        </NavLink>
        <NavLink to="warehouses" className={tabClassName}>
          Almacenes
        </NavLink>
      </nav>
      <Outlet />
    </section>
  );
}
