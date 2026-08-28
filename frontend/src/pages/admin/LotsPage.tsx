import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { Alert, Button, Card, EmptyState, Input, PageHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { productsQuery } from '@/features/catalog/api';
import { CreateLotForm } from '@/features/lots/CreateLotForm';
import {
  matchesExpirationFilter,
  sortLotsForExpiration,
  type ExpirationFilter,
} from '@/features/lots/expiration';
import { LotBalancesPanel } from '@/features/lots/LotBalancesPanel';
import { LotsTable } from '@/features/lots/LotsTable';
import { createLot, lotsQuery, type Lot, type LotCreateInput } from '@/features/lots/api';
import { activeAlertsQuery } from '@/features/notifications/api';
import { suppliersQuery } from '@/features/suppliers/api';

export function LotsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('lot.manage');
  const canSeeAlerts = hasPermission('notification.read');
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('');
  const [expirationFilter, setExpirationFilter] = useState<ExpirationFilter>('all');
  const [selectedLot, setSelectedLot] = useState<Lot | null>(null);

  // Incluye productos inactivos para que los lotes históricos sigan
  // mostrando su nombre. El formulario de alta filtra aparte los productos
  // activos que realmente controlan lotes.
  const products = useQuery(productsQuery({ activeOnly: false }));
  const suppliers = useQuery(suppliersQuery(true));
  const lots = useQuery(lotsQuery(null));
  const alerts = useQuery({ ...activeAlertsQuery, enabled: canSeeAlerts });
  const queryClient = useQueryClient();

  const trackedProducts = (products.data ?? []).filter((product) => product.track_lots);
  const productNames = useMemo(
    () => new Map((products.data ?? []).map((product) => [product.id, product.name])),
    [products.data],
  );
  const expirationAlerts = (alerts.data ?? []).filter(
    (alert) => alert.kind === 'EXPIRATION' && alert.lot_id !== null,
  );
  const alertedLotIds = new Set(expirationAlerts.map((alert) => alert.lot_id!));
  const alertDaysByLot = new Map(
    expirationAlerts
      .filter((alert) => alert.days_remaining !== null)
      .map((alert) => [alert.lot_id!, alert.days_remaining!]),
  );

  const normalizedSearch = search.trim().toLocaleLowerCase('es');
  const visibleLots = sortLotsForExpiration(
    (lots.data ?? []).filter((lot) => {
      const productName = productNames.get(lot.product_id) ?? '';
      return (
        (!normalizedSearch ||
          productName.toLocaleLowerCase('es').includes(normalizedSearch) ||
          lot.lot_number.toLocaleLowerCase('es').includes(normalizedSearch)) &&
        (!productFilter || lot.product_id === Number(productFilter)) &&
        matchesExpirationFilter(lot, expirationFilter, alertedLotIds)
      );
    }),
  );
  const hasFilters = Boolean(search.trim() || productFilter || expirationFilter !== 'all');

  const createMutation = useMutation({
    mutationFn: (payload: LotCreateInput) => createLot(payload),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['lots', 'list'] });
      setShowCreate(false);
      setCreateError(null);
      setSuccess(`Lote ${created.lot_number} creado correctamente.`);
      setSearch(created.lot_number);
    },
    onError: () => setCreateError('No se ha podido crear el lote.'),
  });

  const selectedProduct = selectedLot
    ? (products.data ?? []).find((product) => product.id === selectedLot.product_id)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lotes y caducidad"
        description="Consulta lotes, fechas de caducidad y existencias asociadas."
        actions={
          canManage && !showCreate ? (
            <Button
              onClick={() => {
                setShowCreate(true);
                setCreateError(null);
                setSuccess(null);
              }}
            >
              + Nuevo lote
            </Button>
          ) : undefined
        }
      />

      {showCreate && (
        <CreateLotForm
          products={products.data ?? []}
          suppliers={suppliers.data ?? []}
          initialProductId={selectedLot?.product_id ?? null}
          isPending={createMutation.isPending}
          submitError={createError}
          onCancel={() => {
            setShowCreate(false);
            setCreateError(null);
          }}
          onSubmit={(payload) => createMutation.mutate(payload)}
        />
      )}

      {success && <Alert tone="success">{success}</Alert>}

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm font-semibold text-slate-700">
            Buscar producto o lote
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Yogur o YG-4821…"
              className="mt-1.5"
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Producto
            <select
              value={productFilter}
              onChange={(event) => setProductFilter(event.target.value)}
              className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Todos</option>
              {trackedProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Estado de caducidad
            <select
              value={expirationFilter}
              onChange={(event) => setExpirationFilter(event.target.value as ExpirationFilter)}
              className="mt-1.5 min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">Todos</option>
              <option value="alert">Con aviso de caducidad</option>
              <option value="expired">Caducados</option>
              <option value="undated">Sin fecha</option>
            </select>
          </label>
        </div>
        {hasFilters && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <Button
              variant="ghost"
              className="min-h-8 px-3 py-1"
              onClick={() => {
                setSearch('');
                setProductFilter('');
                setExpirationFilter('all');
              }}
            >
              Limpiar filtros
            </Button>
          </div>
        )}
      </Card>

      {lots.isPending && <p className="text-sm text-slate-500">Cargando lotes…</p>}
      {lots.isError && <Alert tone="error">No se han podido cargar los lotes.</Alert>}
      {lots.isSuccess && visibleLots.length === 0 && (
        <EmptyState
          title={hasFilters ? 'No hay lotes para estos filtros' : 'Todavía no hay lotes'}
          description={
            hasFilters
              ? 'Prueba otra búsqueda o limpia los filtros.'
              : 'Los lotes aparecerán aquí en cuanto se creen o se reciban.'
          }
        />
      )}
      {visibleLots.length > 0 && (
        <LotsTable
          lots={visibleLots}
          productNames={productNames}
          alertDaysByLot={alertDaysByLot}
          selectedLotId={selectedLot?.id ?? null}
          onInspect={setSelectedLot}
        />
      )}

      {selectedLot && selectedProduct && (
        <LotBalancesPanel
          key={selectedProduct.id}
          productId={selectedProduct.id}
          productName={`${selectedProduct.name} · lote ${selectedLot.lot_number}`}
          selectedLotId={selectedLot.id}
          canManage={canManage}
        />
      )}
    </div>
  );
}
