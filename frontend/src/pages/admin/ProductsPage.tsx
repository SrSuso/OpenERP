import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Alert, Button, Card, EmptyState, Input, PageHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import {
  posCategoriesQuery,
  productCategoriesQuery,
  productsQuery,
  unitsQuery,
} from '@/features/catalog/api';
import { ProductsTable } from '@/features/catalog/ProductsTable';
import { stockTotalsQuery } from '@/features/inventory/api';
import { activeAlertsQuery } from '@/features/notifications/api';

export function ProductsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('product.manage');
  const canSeeStock = hasPermission('inventory.read');
  const canSeeAlerts = hasPermission('notification.read');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [unitName, setUnitName] = useState('');
  const [posCategoryId, setPosCategoryId] = useState('');
  const [stockState, setStockState] = useState<'all' | 'low' | 'ok'>('all');
  const [showInactive, setShowInactive] = useState(false);

  const categories = useQuery(productCategoriesQuery);
  const posCategories = useQuery(posCategoriesQuery);
  const units = useQuery(unitsQuery);
  const products = useQuery(
    productsQuery({
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(categoryId ? { categoryId: Number(categoryId) } : {}),
      activeOnly: !showInactive,
    }),
  );
  const stockTotals = useQuery({ ...stockTotalsQuery, enabled: canSeeStock });
  const alerts = useQuery({ ...activeAlertsQuery, enabled: canSeeAlerts });

  const stockByProduct = stockTotals.data
    ? new Map(stockTotals.data.map((total) => [total.product_id, total.quantity]))
    : null;
  const lowStockProductIds = useMemo(
    () =>
      new Set(
        (alerts.data ?? [])
          .filter((alert) => alert.kind === 'LOW_STOCK')
          .map((alert) => alert.product_id),
      ),
    [alerts.data],
  );
  const visibleProducts = (products.data ?? []).filter(
    (product) =>
      (!unitName || product.base_unit_name === unitName) &&
      (!posCategoryId ||
        (posCategoryId === 'none'
          ? product.pos_category_id === null
          : product.pos_category_id === Number(posCategoryId))) &&
      (stockState === 'all' ||
        (stockState === 'low'
          ? lowStockProductIds.has(product.id)
          : !lowStockProductIds.has(product.id))),
  );
  const hasFilters = Boolean(
    categoryId || unitName || posCategoryId || stockState !== 'all' || showInactive,
  );
  const clearFilters = () => {
    setCategoryId('');
    setUnitName('');
    setPosCategoryId('');
    setStockState('all');
    setShowInactive(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        description="Gestiona los productos de la tienda y abre su ficha para modificarlos."
        actions={
          canManage ? (
            <Link
              to="/admin/inventory/products/new"
              className="inline-flex min-h-10 items-center rounded-lg border border-brand-600 bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              + Nuevo producto
            </Link>
          ) : undefined
        }
      />

      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre o código de barras…"
            aria-label="Buscar productos"
            className="flex-1"
          />
          <Button
            variant={showFilters || hasFilters ? 'secondary' : 'ghost'}
            onClick={() => setShowFilters((current) => !current)}
            aria-expanded={showFilters}
          >
            Filtros{hasFilters ? ' · activos' : ''}
          </Button>
        </div>

        {showFilters && (
          <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm font-medium text-slate-700">
              Categoría
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Todas</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Unidad
              <select
                value={unitName}
                onChange={(event) => setUnitName(event.target.value)}
                className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Todas</option>
                {(units.data ?? []).map((unit) => (
                  <option key={unit.id} value={unit.name}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Categoría POS
              <select
                value={posCategoryId}
                onChange={(event) => setPosCategoryId(event.target.value)}
                className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Todas</option>
                <option value="none">Sin categoría POS</option>
                {(posCategories.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              Estado del stock
              <select
                value={stockState}
                onChange={(event) => setStockState(event.target.value as typeof stockState)}
                className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="all">Todos</option>
                <option value="low">Stock bajo</option>
                <option value="ok">Sin aviso de stock</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
              />
              Mostrar inactivos
            </label>
          </div>
        )}

        {hasFilters && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            {categoryId && (
              <FilterChip
                label={`Categoría: ${categories.data?.find((item) => String(item.id) === categoryId)?.name ?? ''}`}
                onClear={() => setCategoryId('')}
              />
            )}
            {unitName && (
              <FilterChip label={`Unidad: ${unitName}`} onClear={() => setUnitName('')} />
            )}
            {posCategoryId && (
              <FilterChip
                label={`Categoría POS: ${posCategoryId === 'none' ? 'Sin asignar' : (posCategories.data?.find((item) => String(item.id) === posCategoryId)?.name ?? '')}`}
                onClear={() => setPosCategoryId('')}
              />
            )}
            {stockState !== 'all' && (
              <FilterChip
                label={stockState === 'low' ? 'Stock bajo' : 'Sin aviso de stock'}
                onClear={() => setStockState('all')}
              />
            )}
            {showInactive && (
              <FilterChip label="Incluye inactivos" onClear={() => setShowInactive(false)} />
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="ml-1 text-sm font-semibold text-brand-700 hover:underline"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600">
          {visibleProducts.length} {visibleProducts.length === 1 ? 'producto' : 'productos'}
        </p>
      </div>

      {products.isPending && <p className="text-sm text-slate-500">Cargando productos…</p>}
      {products.isError && <Alert tone="error">No se han podido cargar los productos.</Alert>}
      {products.isSuccess && visibleProducts.length === 0 && (
        <EmptyState
          title={hasFilters || search ? 'No hay resultados para estos filtros' : 'No hay productos'}
          description={
            hasFilters || search
              ? 'Prueba a cambiar la búsqueda o limpiar los filtros.'
              : 'Crea el primer producto para empezar a gestionar la tienda.'
          }
        />
      )}
      {visibleProducts.length > 0 && (
        <ProductsTable
          products={visibleProducts}
          stockByProduct={stockByProduct}
          lowStockProductIds={lowStockProductIds}
        />
      )}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100"
      aria-label={`Quitar filtro ${label}`}
    >
      {label} ×
    </button>
  );
}
