import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { type UseFormRegisterReturn, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button, Card, FormField, Input } from '@/components/ui';
import {
  type Product,
  type ProductCategory,
  type ProductUpdateInput,
} from '@/features/catalog/api';
import { type NotificationSettings } from '@/features/notifications/api';
import { decimalString } from '@/lib/decimal';
import { formatQuantity } from '@/lib/format';
import { useUnsavedWarning } from '@/lib/unsaved';

const inventorySchema = z
  .object({
    tracks_stock: z.enum(['inherit', 'yes', 'no']),
    stock_alert_mode: z.enum(['GENERAL', 'CUSTOM', 'DISABLED']),
    min_stock: decimalString({ min: 0 }),
    track_lots: z.boolean(),
    track_expiration: z.boolean(),
    expiration_alert_mode: z.enum(['GENERAL', 'CUSTOM']),
    expiration_days: z.coerce.number().int().min(0).max(365),
  })
  .superRefine((values, context) => {
    if (values.stock_alert_mode === 'CUSTOM' && Number(values.min_stock) <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['min_stock'],
        message: 'Introduce un mínimo mayor que cero.',
      });
    }
  });

type InventoryValues = z.infer<typeof inventorySchema>;

export interface ProductAlertUpdateConfig {
  expirationMode: 'GENERAL' | 'CUSTOM';
  expirationDays: number;
}

interface ProductInventoryAlertsFormProps {
  product: Product;
  category: ProductCategory | undefined;
  settings: NotificationSettings;
  totalStock: number | null;
  hasLowStockAlert: boolean;
  canManageProduct: boolean;
  canReadNotifications: boolean;
  canManageNotifications: boolean;
  isPending: boolean;
  feedback: string | null;
  submitError: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (productPayload: ProductUpdateInput, alerts: ProductAlertUpdateConfig) => void;
}

export function ProductInventoryAlertsForm({
  product,
  category,
  settings,
  totalStock,
  hasLowStockAlert,
  canManageProduct,
  canReadNotifications,
  canManageNotifications,
  isPending,
  feedback,
  submitError,
  onDirtyChange,
  onSubmit,
}: ProductInventoryAlertsFormProps) {
  const specificExpiration = settings.product_expirations.find(
    (item) => item.product_id === product.id,
  );
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<InventoryValues>({
    resolver: zodResolver(inventorySchema),
    defaultValues: {
      tracks_stock: product.tracks_stock === null ? 'inherit' : product.tracks_stock ? 'yes' : 'no',
      stock_alert_mode: product.stock_alert_mode,
      min_stock: product.min_stock,
      track_lots: product.track_lots,
      track_expiration: product.track_expiration,
      expiration_alert_mode: specificExpiration ? 'CUSTOM' : 'GENERAL',
      expiration_days:
        specificExpiration?.days_before_expiration ??
        settings.general_expiration.days_before_expiration,
    },
  });
  const tracksStock = watch('tracks_stock');
  const stockAlertMode = watch('stock_alert_mode');
  const trackExpiration = watch('track_expiration');
  const expirationAlertMode = watch('expiration_alert_mode');
  const effectiveTracksStock =
    tracksStock === 'inherit' ? (category?.tracks_stock ?? true) : tracksStock === 'yes';

  useUnsavedWarning(isDirty);
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);

  const submit = handleSubmit((values) => {
    const productPayload: ProductUpdateInput = {};
    if (canManageProduct) {
      productPayload.track_lots = values.track_lots;
      productPayload.track_expiration = values.track_expiration;
      if (values.tracks_stock === 'inherit') productPayload.inherit_tracks_stock = true;
      else productPayload.tracks_stock = values.tracks_stock === 'yes';
    }
    if (canManageProduct && canManageNotifications) {
      productPayload.stock_alert_mode = values.stock_alert_mode;
      if (values.stock_alert_mode === 'CUSTOM') productPayload.min_stock = values.min_stock;
    }
    onSubmit(productPayload, {
      expirationMode: values.expiration_alert_mode,
      expirationDays: values.expiration_days,
    });
  });

  const effectiveMinimum =
    product.stock_alert_mode === 'CUSTOM' ? product.min_stock : settings.stock_general.min_stock;

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-500">Stock actual</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">
            {totalStock === null
              ? '—'
              : `${formatQuantity(String(totalStock))} ${product.base_unit_name}`}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-500">Mínimo efectivo</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">
            {!canReadNotifications
              ? '—'
              : !product.effective_tracks_stock || product.stock_alert_mode === 'DISABLED'
                ? 'Sin aviso'
                : `${formatQuantity(effectiveMinimum)} ${product.base_unit_name}`}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-sm font-semibold text-slate-500">Estado</p>
          <p
            className={`mt-2 text-lg font-bold ${hasLowStockAlert ? 'text-amber-800' : 'text-emerald-700'}`}
          >
            {hasLowStockAlert ? 'Stock bajo' : 'Correcto'}
          </p>
          {hasLowStockAlert && totalStock !== null && (
            <p className="mt-1 text-sm text-slate-600">
              Faltan {formatQuantity(String(Math.max(Number(effectiveMinimum) - totalStock, 0)))}{' '}
              {product.base_unit_name}.
            </p>
          )}
        </Card>
      </div>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">Control de inventario</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-semibold text-slate-700">
            Control de existencias
            <select
              {...register('tracks_stock')}
              disabled={!canManageProduct}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal disabled:bg-slate-100"
            >
              <option value="inherit">
                Usar la categoría ({(category?.tracks_stock ?? true) ? 'sí' : 'no'})
              </option>
              <option value="yes">Sí, llevar stock</option>
              <option value="no">No controlar existencias</option>
            </select>
          </label>
          <div className="space-y-3 pt-1 text-sm text-slate-700">
            <label className="flex items-center gap-2">
              <input type="checkbox" disabled={!canManageProduct} {...register('track_lots')} />
              Control de lotes
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={!canManageProduct}
                {...register('track_expiration')}
              />
              Control de caducidad
            </label>
          </div>
        </div>
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">Aviso de stock</h2>
        {!canReadNotifications ? (
          <p className="mt-3 text-sm text-slate-600">
            Tu perfil no puede ver la configuración de avisos.
          </p>
        ) : !effectiveTracksStock ? (
          <p className="mt-3 text-sm text-slate-600">
            No disponible porque este producto no controla existencias.
          </p>
        ) : (
          <fieldset
            disabled={!canManageProduct || !canManageNotifications}
            className="mt-4 space-y-3 disabled:opacity-70"
          >
            <Radio
              registration={register('stock_alert_mode')}
              value="GENERAL"
              label="Usar mínimo general"
              detail={`Actualmente: ${formatQuantity(settings.stock_general.min_stock)} ${product.base_unit_name}`}
            />
            <Radio
              registration={register('stock_alert_mode')}
              value="CUSTOM"
              label="Definir mínimo para este producto"
            />
            {stockAlertMode === 'CUSTOM' && (
              <div className="ml-6 max-w-xs">
                <FormField
                  label="Stock mínimo"
                  htmlFor="detail-min-stock"
                  error={errors.min_stock?.message ?? null}
                >
                  <Input id="detail-min-stock" inputMode="decimal" {...register('min_stock')} />
                </FormField>
              </div>
            )}
            <Radio
              registration={register('stock_alert_mode')}
              value="DISABLED"
              label="No avisar por stock"
            />
          </fieldset>
        )}
        {!canManageNotifications && (
          <p className="mt-3 text-sm text-slate-500">
            Tu perfil puede ver esta configuración, pero no modificar avisos.
          </p>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">Aviso de caducidad</h2>
        {!canReadNotifications ? (
          <p className="mt-3 text-sm text-slate-600">
            Tu perfil no puede ver la configuración de avisos.
          </p>
        ) : !trackExpiration ? (
          <p className="mt-3 text-sm text-slate-600">
            Activa el control de caducidad para configurar avisos.
          </p>
        ) : (
          <fieldset
            disabled={!canManageNotifications}
            className="mt-4 space-y-3 disabled:opacity-70"
          >
            <Radio
              registration={register('expiration_alert_mode')}
              value="GENERAL"
              label="Usar configuración general"
              detail={`Actualmente: ${settings.general_expiration.days_before_expiration} días antes`}
            />
            <Radio
              registration={register('expiration_alert_mode')}
              value="CUSTOM"
              label="Personalizar para este producto"
            />
            {expirationAlertMode === 'CUSTOM' && (
              <div className="ml-6 max-w-xs">
                <FormField
                  label="Avisar con"
                  htmlFor="detail-expiration-days"
                  hint="Días de antelación."
                >
                  <Input
                    id="detail-expiration-days"
                    type="number"
                    min={0}
                    max={365}
                    {...register('expiration_days')}
                  />
                </FormField>
              </div>
            )}
          </fieldset>
        )}
      </Card>

      {feedback && (
        <p role="status" className="text-sm font-semibold text-emerald-700">
          {feedback}
        </p>
      )}
      {submitError && (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {submitError}
        </p>
      )}
      {(canManageProduct || canManageNotifications) && (
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending || !isDirty}>
            {isPending ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      )}
    </form>
  );
}

function Radio({
  registration,
  value,
  label,
  detail,
}: {
  registration: UseFormRegisterReturn;
  value: string;
  label: string;
  detail?: string;
}) {
  return (
    <label className="flex items-start gap-3 text-sm text-slate-700">
      <input type="radio" value={value} {...registration} className="mt-1" />
      <span>
        <strong className="block">{label}</strong>
        {detail && <span className="text-slate-500">{detail}</span>}
      </span>
    </label>
  );
}
