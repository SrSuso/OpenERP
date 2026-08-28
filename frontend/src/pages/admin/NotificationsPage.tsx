import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { NavLink } from 'react-router';

import { Alert, Button, Card, EmptyState, FormField, Input, PageHeader } from '@/components/ui';
import { productsQuery, type Product } from '@/features/catalog/api';
import { useAuth } from '@/features/auth/useAuth';
import {
  activeAlertsQuery,
  notificationSettingsQuery,
  removeProductExpiration,
  updateGeneralExpiration,
  updateProductExpiration,
  type ActiveAlert,
  type NotificationSettings,
} from '@/features/notifications/api';
import { formatQuantity } from '@/lib/format';

const tabClassName = (active: boolean) =>
  `rounded-lg px-4 py-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
    active ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`;

function expirationDateLabel(value: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function StockAlertCard({
  alert,
  canOpenProduct,
}: {
  alert: ActiveAlert;
  canOpenProduct: boolean;
}) {
  return (
    <Card className="p-5">
      <h3 className="font-bold text-slate-900">{alert.title}</h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-slate-500">Stock actual</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">
            {formatQuantity(alert.stock_current ?? '0')}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Stock mínimo</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">
            {formatQuantity(alert.min_stock ?? '0')}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Reponer</dt>
          <dd className="mt-0.5 font-bold text-amber-800">
            {formatQuantity(alert.replenish ?? '0')}
          </dd>
        </div>
      </dl>
      {canOpenProduct && alert.product_id !== null && (
        <NavLink
          to={`/admin/inventory/products/${alert.product_id}`}
          className="mt-4 inline-block rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Ver producto
        </NavLink>
      )}
    </Card>
  );
}

function ExpirationAlertCard({ alert, canOpenLots }: { alert: ActiveAlert; canOpenLots: boolean }) {
  const days = alert.days_remaining ?? 0;
  return (
    <Card className="p-5">
      <h3 className="font-bold text-slate-900">{alert.title}</h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Lote</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">{alert.lot_number ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Caduca</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">
            {alert.expiration_date ? expirationDateLabel(alert.expiration_date) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Tiempo restante</dt>
          <dd className="mt-0.5 font-bold text-amber-800">
            {days < 0
              ? `Caducó hace ${Math.abs(days)} días`
              : days === 0
                ? 'Caduca hoy'
                : `${days} días`}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Cantidad restante</dt>
          <dd className="mt-0.5 font-semibold text-slate-900">
            {formatQuantity(alert.quantity_remaining ?? '0')}
          </dd>
        </div>
      </dl>
      {canOpenLots && (
        <NavLink
          to="/admin/inventory/lots"
          className="mt-4 inline-block rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          Ver lotes
        </NavLink>
      )}
    </Card>
  );
}

function AlertGroup({
  title,
  alerts,
  children,
}: {
  title: string;
  alerts: ActiveAlert[];
  children: (alert: ActiveAlert) => ReactNode;
}) {
  if (alerts.length === 0) return null;
  return (
    <section aria-labelledby={`alerts-${alerts[0]!.kind.toLowerCase()}`}>
      <div className="mb-3 flex items-center gap-2">
        <h2
          id={`alerts-${alerts[0]!.kind.toLowerCase()}`}
          className="text-lg font-bold text-slate-900"
        >
          {title}
        </h2>
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-900">
          {alerts.length}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{alerts.map(children)}</div>
    </section>
  );
}

interface ExpirationProductFormProps {
  configuredProductIds: Set<number>;
  isPending: boolean;
  onCancel: () => void;
  onSave: (product: Product, days: number) => void;
}

function ExpirationProductForm({
  configuredProductIds,
  isPending,
  onCancel,
  onSave,
}: ExpirationProductFormProps) {
  const productFieldId = useId();
  const daysFieldId = useId();
  const [query, setQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [days, setDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  const search = query.trim();
  const products = useQuery({
    ...productsQuery({ activeOnly: true, search, limit: 8 }),
    enabled: search.length >= 2,
  });
  const matches = (products.data ?? []).filter(
    (product) => product.track_expiration && !configuredProductIds.has(product.id),
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const parsedDays = Number(days);
        if (!selectedProduct) {
          setError('Selecciona un producto de los resultados.');
          return;
        }
        if (!Number.isInteger(parsedDays) || parsedDays < 0 || parsedDays > 365) {
          setError('Introduce un número de días entre 0 y 365.');
          return;
        }
        setError(null);
        onSave(selectedProduct, parsedDays);
      }}
      className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 sm:p-5"
    >
      <h3 className="font-bold text-slate-900">Nuevo aviso de caducidad</h3>
      <p className="mt-1 text-sm text-slate-600">
        Esta antelación sustituirá a la general únicamente para el producto elegido.
      </p>
      <div className="mt-5 grid gap-4 sm:max-w-xl">
        <FormField
          label="Producto"
          htmlFor={productFieldId}
          hint="Escribe al menos dos letras del nombre o escanea el código de barras."
        >
          <div className="relative">
            <Input
              id={productFieldId}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedProduct(null);
              }}
              placeholder="Buscar producto…"
              autoComplete="off"
            />
            {search.length >= 2 && !selectedProduct && (
              <div
                role="listbox"
                aria-label="Resultados de producto"
                className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-300 bg-white p-1 shadow-lg"
              >
                {products.isPending && (
                  <p className="px-3 py-2 text-sm text-slate-500">Buscando…</p>
                )}
                {products.isSuccess && matches.length === 0 && (
                  <p className="px-3 py-2 text-sm text-slate-500">
                    No hay productos con caducidad que coincidan.
                  </p>
                )}
                {matches.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => {
                      setSelectedProduct(product);
                      setQuery(product.name);
                    }}
                    className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {product.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </FormField>
        <FormField label="Avisar con" htmlFor={daysFieldId} hint="Días de antelación.">
          <Input
            id={daysFieldId}
            type="number"
            min={0}
            max={365}
            inputMode="numeric"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            className="max-w-40"
          />
        </FormField>
      </div>
      {error && (
        <p className="mt-4 text-sm font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar'}
        </Button>
      </div>
    </form>
  );
}

/** Store-facing alerts: current conditions first, configuration second.
 * Generic CONDITION rules remain compatible in the backend but their
 * technical constructor is deliberately absent from this V2 workflow. */
export function NotificationsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('notification.manage');
  const canOpenProducts = hasPermission('product.read');
  const canOpenLots = hasPermission('lot.read');
  const [tab, setTab] = useState<'active' | 'settings'>('active');
  const [showProductForm, setShowProductForm] = useState(false);
  const [generalEnabled, setGeneralEnabled] = useState(false);
  const [generalDays, setGeneralDays] = useState('7');
  const [feedback, setFeedback] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const alerts = useQuery(activeAlertsQuery);
  const settings = useQuery(notificationSettingsQuery);

  useEffect(() => {
    if (!settings.data) return;
    setGeneralEnabled(settings.data.general_expiration.enabled);
    setGeneralDays(String(settings.data.general_expiration.days_before_expiration));
  }, [settings.data]);

  const cacheSettings = (updated: NotificationSettings) => {
    queryClient.setQueryData(notificationSettingsQuery.queryKey, updated);
    void queryClient.invalidateQueries({ queryKey: activeAlertsQuery.queryKey });
  };
  const generalMutation = useMutation({
    mutationFn: () => {
      const parsedDays = Number(generalDays);
      if (!Number.isInteger(parsedDays) || parsedDays < 0 || parsedDays > 365) {
        throw new Error('Introduce un número de días entre 0 y 365.');
      }
      return updateGeneralExpiration({
        enabled: generalEnabled,
        days_before_expiration: parsedDays,
      });
    },
    onSuccess: (updated) => {
      cacheSettings(updated);
      setFeedback('Configuración general guardada.');
    },
  });
  const productMutation = useMutation({
    mutationFn: ({ product, days }: { product: Product; days: number }) =>
      updateProductExpiration(product.id, days),
    onSuccess: (updated) => {
      cacheSettings(updated);
      setShowProductForm(false);
      setFeedback('Configuración del producto guardada.');
    },
  });
  const removeMutation = useMutation({
    mutationFn: (productId: number) => removeProductExpiration(productId),
    onSuccess: (updated) => {
      cacheSettings(updated);
      setFeedback('La configuración específica se ha retirado.');
    },
  });

  const active = alerts.data ?? [];
  const lowStock = active.filter((alert) => alert.kind === 'LOW_STOCK');
  const expiration = active.filter((alert) => alert.kind === 'EXPIRATION');
  const other = active.filter((alert) => alert.kind === 'OTHER');
  const configuredProductIds = new Set(
    (settings.data?.product_expirations ?? []).map((item) => item.product_id),
  );
  const mutationError =
    generalMutation.error ?? productMutation.error ?? removeMutation.error ?? null;
  const mutationErrorMessage =
    mutationError?.message === 'Introduce un número de días entre 0 y 365.'
      ? mutationError.message
      : 'No se ha podido guardar la configuración.';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Avisos"
        description="Consulta lo que necesita atención y configura cuándo avisar de caducidades."
      />

      <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" aria-label="Avisos">
        <button
          type="button"
          onClick={() => setTab('active')}
          className={tabClassName(tab === 'active')}
        >
          Avisos activos
        </button>
        <button
          type="button"
          onClick={() => setTab('settings')}
          className={tabClassName(tab === 'settings')}
        >
          Configuración de avisos
        </button>
      </nav>

      {tab === 'active' && (
        <div className="space-y-8">
          {alerts.isPending && <p className="text-sm text-slate-500">Cargando avisos…</p>}
          {alerts.isError && (
            <Alert tone="error">No se han podido cargar los avisos activos.</Alert>
          )}
          {alerts.isSuccess && active.length === 0 && (
            <EmptyState
              title="No hay avisos activos"
              description="No hay productos con stock bajo, lotes próximos a caducar ni otros asuntos pendientes."
            />
          )}
          <AlertGroup title="Stock bajo" alerts={lowStock}>
            {(alert) => (
              <StockAlertCard key={alert.id} alert={alert} canOpenProduct={canOpenProducts} />
            )}
          </AlertGroup>
          <AlertGroup title="Caducidad" alerts={expiration}>
            {(alert) => (
              <ExpirationAlertCard key={alert.id} alert={alert} canOpenLots={canOpenLots} />
            )}
          </AlertGroup>
          <AlertGroup title="Otros avisos" alerts={other}>
            {(alert) => (
              <Card key={alert.id} className="p-5">
                <h3 className="font-bold text-slate-900">{alert.title}</h3>
                {alert.message && <p className="mt-2 text-sm text-slate-600">{alert.message}</p>}
              </Card>
            )}
          </AlertGroup>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-6">
          {settings.isPending && <p className="text-sm text-slate-500">Cargando configuración…</p>}
          {settings.isError && (
            <Alert tone="error">No se ha podido cargar la configuración de avisos.</Alert>
          )}
          {feedback && <Alert tone="success">{feedback}</Alert>}
          {mutationError && <Alert tone="error">{mutationErrorMessage}</Alert>}

          {settings.data && (
            <>
              <Card className="p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">Stock mínimo</h2>
                    <p className="mt-1 font-semibold text-emerald-700">Automático</p>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600">
                      OpenERP avisa cuando el stock actual es inferior al mínimo configurado en la
                      ficha del producto. El aviso desaparece automáticamente al reponerlo.
                    </p>
                  </div>
                  {canOpenProducts && (
                    <NavLink
                      to="/admin/inventory/products"
                      className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      Gestionar productos
                    </NavLink>
                  )}
                </div>
              </Card>

              <Card className="p-5 sm:p-6">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Caducidad</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    La configuración de un producto sustituye por completo a la general.
                  </p>
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    setFeedback(null);
                    generalMutation.mutate();
                  }}
                  className="mt-6 border-t border-slate-200 pt-5"
                >
                  <h3 className="font-bold text-slate-900">Configuración general</h3>
                  <label className="mt-4 flex max-w-xl items-start gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={generalEnabled}
                      onChange={(event) => setGeneralEnabled(event.target.checked)}
                      disabled={!canManage}
                      className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span>
                      <span className="block font-semibold">
                        Avisar para productos sin configuración específica
                      </span>
                      <span className="mt-1 block text-slate-500">
                        Si se desactiva, sólo avisarán los productos configurados más abajo.
                      </span>
                    </span>
                  </label>
                  <div className="mt-4 max-w-48">
                    <FormField
                      label="Avisar con"
                      htmlFor="general-expiration-days"
                      hint="Días de antelación."
                    >
                      <Input
                        id="general-expiration-days"
                        type="number"
                        min={0}
                        max={365}
                        inputMode="numeric"
                        value={generalDays}
                        onChange={(event) => setGeneralDays(event.target.value)}
                        disabled={!canManage}
                      />
                    </FormField>
                  </div>
                  {canManage && (
                    <div className="mt-5">
                      <Button type="submit" disabled={generalMutation.isPending}>
                        {generalMutation.isPending ? 'Guardando…' : 'Guardar configuración general'}
                      </Button>
                    </div>
                  )}
                </form>

                <section
                  className="mt-8 border-t border-slate-200 pt-5"
                  aria-labelledby="product-expirations"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 id="product-expirations" className="font-bold text-slate-900">
                        Configuración por producto
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        Cada producto utiliza únicamente sus propios días.
                      </p>
                    </div>
                    {canManage && !showProductForm && (
                      <Button variant="secondary" onClick={() => setShowProductForm(true)}>
                        Añadir producto
                      </Button>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    {settings.data.product_expirations.length === 0 && !showProductForm && (
                      <EmptyState
                        title="No hay configuraciones específicas"
                        description="Los productos utilizarán la configuración general si está activa."
                      />
                    )}
                    {settings.data.product_expirations.map((item) => (
                      <div
                        key={item.product_id}
                        className="grid gap-3 rounded-lg border border-slate-200 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                      >
                        <p className="font-semibold text-slate-800">{item.product_name}</p>
                        <p className="text-sm text-slate-600">
                          {item.days_before_expiration} días antes
                        </p>
                        {canManage && (
                          <Button
                            variant="ghost"
                            onClick={() => removeMutation.mutate(item.product_id)}
                            disabled={removeMutation.isPending}
                          >
                            Quitar
                          </Button>
                        )}
                      </div>
                    ))}
                    {showProductForm && (
                      <ExpirationProductForm
                        configuredProductIds={configuredProductIds}
                        isPending={productMutation.isPending}
                        onCancel={() => setShowProductForm(false)}
                        onSave={(product, days) => productMutation.mutate({ product, days })}
                      />
                    )}
                  </div>
                </section>
              </Card>

              {settings.data.custom_rules.length > 0 && (
                <Card className="p-5 sm:p-6">
                  <h2 className="text-lg font-bold text-slate-900">
                    Reglas personalizadas existentes
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Se conservan por compatibilidad. V2 no permite crear nuevas reglas técnicas.
                  </p>
                  <ul className="mt-4 divide-y divide-slate-100">
                    {settings.data.custom_rules.map((rule) => (
                      <li key={rule.name} className="flex items-center justify-between gap-4 py-3">
                        <span className="font-medium text-slate-800">{rule.name}</span>
                        <span className="text-sm text-slate-500">
                          {rule.is_active ? 'Activa' : 'Inactiva'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
