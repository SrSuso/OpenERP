import { NavLink, Outlet } from 'react-router';

const tabClassName = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-4 py-2 text-sm font-medium ${
    isActive
      ? 'border-brand-700 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;

/** `/admin/pricing` — gated by `pricing.manage` in routes.tsx (todo el
 * módulo, lectura incluida: no tiene sentido ver el catálogo de impuestos
 * ni la fórmula sin poder tocar nada). Mismo patrón de pestañas que
 * `/admin/access` y `/admin/inventory`. */
export function PricingPage() {
  return (
    <section>
      <nav className="mb-6 flex gap-2 border-b border-slate-200" aria-label="Precios">
        <NavLink to="taxes" className={tabClassName}>
          Impuestos
        </NavLink>
        <NavLink to="formula" className={tabClassName}>
          Fórmula
        </NavLink>
      </nav>
      <Outlet />
    </section>
  );
}
