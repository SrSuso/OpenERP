import { NavLink, Outlet } from 'react-router';

const tabClassName = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-4 py-2 text-sm font-medium ${
    isActive
      ? 'border-brand-700 text-brand-700'
      : 'border-transparent text-slate-500 hover:text-slate-700'
  }`;

/** `/admin/catalog` — gated by `product.read` in routes.tsx (both tabs'
 * data needs no more than that to view; each panel inside gates its own
 * mutations by `product.manage`/`pos_category.manage`, see
 * CategoriesPage.tsx). */
export function CatalogPage() {
  return (
    <section>
      <nav className="mb-6 flex gap-2 border-b border-slate-200" aria-label="Catálogo">
        <NavLink to="products" className={tabClassName}>
          Productos
        </NavLink>
        <NavLink to="categories" className={tabClassName}>
          Categorías
        </NavLink>
      </nav>
      <Outlet />
    </section>
  );
}
