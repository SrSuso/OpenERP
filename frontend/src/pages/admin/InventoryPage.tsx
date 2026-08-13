import { NavLink, Navigate, Outlet } from 'react-router';

import { useAuth } from '@/features/auth/useAuth';

const tabClassName = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-4 py-2 text-sm font-medium ${
    isActive
      ? 'border-brand-700 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;

/** `/admin/inventory` — un único apartado para todo lo relacionado con
 * productos (pedido explícito del usuario: "para mí un inventario es de
 * productos y donde se gestiona todo lo relacionado con ellos"), antes
 * repartido en tres sitios distintos del menú (Catálogo/Lotes/Inventario).
 * Cada pestaña sigue detrás de su propio `RequirePermission` en
 * routes.tsx (rule 11) — aquí sólo se decide cuáles se ven. */
export function InventoryPage() {
  const { hasPermission } = useAuth();

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Inventario</h1>
      <nav className="mb-6 flex flex-wrap gap-2 border-b border-slate-200" aria-label="Inventario">
        {hasPermission('product.read') && (
          <>
            <NavLink to="products" className={tabClassName}>
              Productos
            </NavLink>
            <NavLink to="categories" className={tabClassName}>
              Categorías
            </NavLink>
          </>
        )}
        {hasPermission('lot.read') && (
          <NavLink to="lots" className={tabClassName}>
            Lotes
          </NavLink>
        )}
        {hasPermission('inventory.read') && (
          <>
            <NavLink to="balances" className={tabClassName}>
              Saldos
            </NavLink>
            <NavLink to="movements" className={tabClassName}>
              Movimientos
            </NavLink>
            <NavLink to="warehouses" className={tabClassName}>
              Almacenes
            </NavLink>
            {hasPermission('inventory.manage') && (
              <NavLink to="terminals" className={tabClassName}>
                Terminales POS
              </NavLink>
            )}
          </>
        )}
      </nav>
      <Outlet />
    </section>
  );
}

/** `/admin/inventory` en sí (ruta índice) no tiene nada propio que
 * mostrar — manda a la primera pestaña que los permisos del visitante
 * realmente permitan, en el mismo orden en que aparecen arriba. Mismo
 * razonamiento que `AccessIndexRedirect`. */
export function InventoryIndexRedirect() {
  const { hasPermission } = useAuth();

  if (hasPermission('product.read')) return <Navigate to="products" replace />;
  if (hasPermission('lot.read')) return <Navigate to="lots" replace />;
  if (hasPermission('inventory.read')) return <Navigate to="balances" replace />;
  // Inalcanzable en la práctica — RequireAnyPermission en la ruta padre ya
  // aparta de aquí a quien no tenga ninguno de los tres.
  return <Navigate to="/admin" replace />;
}
