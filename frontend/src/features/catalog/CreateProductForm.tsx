import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { type UseFormRegisterReturn, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button, Card, FormField, Input } from '@/components/ui';
import {
  type PosCategory,
  type ProductCategory,
  type ProductCreateInput,
  type Unit,
} from '@/features/catalog/api';
import { previewFormula, type Tax } from '@/features/pricing/api';
import { TaxChips } from '@/features/pricing/TaxChips';
import { decimalString } from '@/lib/decimal';
import { formatMoney, formatQuantity } from '@/lib/format';
import { cancelWithConfirm, useUnsavedWarning } from '@/lib/unsaved';

const createProductSchema = z
  .object({
    name: z.string().min(1, 'Introduce un nombre.').max(255),
    description: z.string().max(2000).optional(),
    category_id: z.string(),
    pos_category_id: z.string(),
    pos_display_order: z.coerce.number().int().min(0),
    is_open_price: z.boolean(),
    base_unit_name: z.string().min(1, 'Elige una unidad.'),
    base_barcode: z.string().max(64).optional(),
    cost: decimalString({ min: 0 }),
    list_price: decimalString({ min: 0 }),
    margin_rate: z.string(),
    margin_amount: z.string(),
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

type CreateProductFormValues = z.infer<typeof createProductSchema>;

export interface ProductAlertCreateConfig {
  expirationMode: 'GENERAL' | 'CUSTOM';
  expirationDays: number;
}

interface CreateProductFormProps {
  categories: ProductCategory[];
  posCategories: PosCategory[];
  units: Unit[];
  taxes: Tax[];
  generalStockMinimum: string;
  generalExpirationDays: number;
  canManageNotifications: boolean;
  onSubmit: (
    payload: ProductCreateInput,
    taxIds: number[],
    alerts: ProductAlertCreateConfig,
  ) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

function categoryMarginRate(categories: ProductCategory[], categoryId: string): string {
  return categories.find((item) => String(item.id) === categoryId)?.margin_rate ?? '0';
}

function categoryMarginAmount(categories: ProductCategory[], categoryId: string): string {
  return categories.find((item) => String(item.id) === categoryId)?.margin_amount ?? '0';
}

function effectiveTaxRatePreview(
  categories: ProductCategory[],
  categoryId: string,
  taxes: Tax[],
  selectedTaxIds: Set<number>,
): string {
  if (selectedTaxIds.size > 0) {
    return taxes
      .filter((tax) => selectedTaxIds.has(tax.id))
      .reduce((sum, tax) => sum + Number(tax.rate), 0)
      .toString();
  }
  return (
    categories
      .find((item) => String(item.id) === categoryId)
      ?.taxes.reduce((sum, tax) => sum + Number(tax.rate), 0)
      .toString() ?? '0'
  );
}

export function CreateProductForm({
  categories,
  posCategories,
  units,
  taxes,
  generalStockMinimum,
  generalExpirationDays,
  canManageNotifications,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateProductFormProps) {
  const [isTaxOverride, setIsTaxOverride] = useState(false);
  const [taxIds, setTaxIds] = useState<Set<number>>(new Set());
  const [estimatedPrice, setEstimatedPrice] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CreateProductFormValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      category_id: '',
      pos_category_id: '',
      pos_display_order: 0,
      is_open_price: false,
      base_unit_name: '',
      cost: '0',
      list_price: '0',
      margin_rate: '',
      margin_amount: '',
      tracks_stock: 'inherit',
      stock_alert_mode: 'GENERAL',
      min_stock: '0',
      track_lots: false,
      track_expiration: false,
      expiration_alert_mode: 'GENERAL',
      expiration_days: generalExpirationDays,
    },
  });
  const categoryId = watch('category_id');
  const cost = watch('cost');
  const marginRate = watch('margin_rate');
  const marginAmount = watch('margin_amount');
  const tracksStock = watch('tracks_stock');
  const stockAlertMode = watch('stock_alert_mode');
  const trackExpiration = watch('track_expiration');
  const expirationAlertMode = watch('expiration_alert_mode');
  const inheritedTracksStock =
    categories.find((category) => String(category.id) === categoryId)?.tracks_stock ?? true;
  const effectiveTracksStock =
    tracksStock === 'inherit' ? inheritedTracksStock : tracksStock === 'yes';
  const categoryTaxIds = new Set(
    (categories.find((item) => String(item.id) === categoryId)?.taxes ?? []).map((tax) => tax.id),
  );

  useUnsavedWarning(isDirty);

  useEffect(() => {
    const defaultUnit = categories.find(
      (category) => String(category.id) === categoryId,
    )?.default_unit_name;
    if (defaultUnit) setValue('base_unit_name', defaultUnit);
  }, [categories, categoryId, setValue]);

  const previewMutation = useMutation({
    mutationFn: (input: {
      cost: string;
      margin_rate: string;
      margin_amount: string;
      tax_rate: string;
    }) =>
      previewFormula({
        formula:
          '(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)',
        cost: input.cost,
        tax_rate: input.tax_rate,
        surcharge_rate: '0',
        margin_rate: input.margin_rate,
        margin_amount: input.margin_amount,
      }),
    onSuccess: setEstimatedPrice,
    onError: () => setEstimatedPrice(null),
  });

  useEffect(() => {
    if (!cost || Number.isNaN(Number(cost.replace(',', '.')))) return;
    const handle = setTimeout(() => {
      previewMutation.mutate({
        cost: cost.replace(',', '.'),
        margin_rate: marginRate.trim() || categoryMarginRate(categories, categoryId),
        margin_amount:
          marginAmount.trim().replace(',', '.') || categoryMarginAmount(categories, categoryId),
        tax_rate: effectiveTaxRatePreview(categories, categoryId, taxes, taxIds),
      });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost, marginRate, marginAmount, categoryId, categories, taxes, taxIds]);

  const submit = handleSubmit((values) =>
    onSubmit(
      {
        name: values.name,
        description: values.description ?? '',
        category_id: values.category_id ? Number(values.category_id) : null,
        pos_category_id: values.pos_category_id ? Number(values.pos_category_id) : null,
        pos_display_order: values.pos_display_order,
        is_open_price: values.is_open_price,
        base_unit_name: values.base_unit_name,
        base_barcode: values.base_barcode?.trim() || null,
        cost: values.cost,
        list_price: values.list_price,
        margin_rate: values.margin_rate.trim() || null,
        margin_amount: values.margin_amount.trim() || null,
        min_stock: values.stock_alert_mode === 'CUSTOM' ? values.min_stock : '0',
        stock_alert_mode: values.stock_alert_mode,
        track_lots: values.track_lots,
        track_expiration: values.track_expiration,
        tracks_stock: values.tracks_stock === 'inherit' ? null : values.tracks_stock === 'yes',
      },
      isTaxOverride ? [...taxIds] : [],
      {
        expirationMode:
          canManageNotifications && values.track_expiration
            ? values.expiration_alert_mode
            : 'GENERAL',
        expirationDays: values.expiration_days,
      },
    ),
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="space-y-6">
      <FormSection
        title="Información básica"
        description="Cómo se identifica y organiza el producto."
      >
        <FormField label="Nombre" htmlFor="product-name" error={errors.name?.message ?? null}>
          <Input id="product-name" {...register('name')} />
        </FormField>
        <FormField label="Código de barras" htmlFor="product-barcode" hint="Opcional.">
          <Input
            id="product-barcode"
            {...register('base_barcode')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Descripción" htmlFor="product-description">
            <Input id="product-description" {...register('description')} />
          </FormField>
        </div>
        <SelectField label="Categoría" registration={register('category_id')}>
          <option value="">Sin categoría</option>
          {categories
            .filter((item) => item.is_active)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </SelectField>
        <SelectField label="Categoría POS" registration={register('pos_category_id')}>
          <option value="">Sin categoría POS</option>
          {posCategories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Unidad base"
          registration={register('base_unit_name')}
          error={errors.base_unit_name?.message ?? ''}
        >
          <option value="">Elige una unidad…</option>
          {units.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <FormField label="Orden en el TPV" htmlFor="product-pos-order">
          <Input id="product-pos-order" type="number" min={0} {...register('pos_display_order')} />
        </FormField>
        <label className="flex items-start gap-3 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" className="mt-1" {...register('is_open_price')} />
          <span>
            <strong className="block">Precio libre en TPV</strong>El importe se pedirá al añadirlo a
            la venta.
          </span>
        </label>
      </FormSection>

      <FormSection title="Precio" description="Coste, márgenes e importe final de venta.">
        <FormField label="Coste" htmlFor="product-cost" error={errors.cost?.message ?? null}>
          <Input id="product-cost" inputMode="decimal" {...register('cost')} />
        </FormField>
        <FormField
          label="Precio de venta"
          htmlFor="product-list-price"
          error={errors.list_price?.message ?? null}
        >
          <Input id="product-list-price" inputMode="decimal" {...register('list_price')} />
        </FormField>
        <FormField
          label="Margen porcentual"
          htmlFor="product-margin"
          hint="Vacío: hereda de la categoría."
        >
          <Input id="product-margin" inputMode="decimal" {...register('margin_rate')} />
        </FormField>
        <FormField label="Margen fijo" htmlFor="product-margin-amount" hint="Euros; vacío: hereda.">
          <Input id="product-margin-amount" inputMode="decimal" {...register('margin_amount')} />
        </FormField>
        <div className="sm:col-span-2">
          <p className="text-sm font-semibold text-slate-700">Impuestos</p>
          <div className="mt-2">
            <TaxChips
              taxes={taxes}
              selected={isTaxOverride ? taxIds : categoryTaxIds}
              onChange={(next) => {
                setTaxIds(next);
                setIsTaxOverride(true);
              }}
            />
          </div>
        </div>
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 sm:col-span-2">
          <p className="text-sm text-slate-600">PVP estimado</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {estimatedPrice ? formatMoney(estimatedPrice) : '—'}
          </p>
          {estimatedPrice && (
            <Button
              variant="ghost"
              className="mt-2"
              onClick={() => setValue('list_price', estimatedPrice, { shouldDirty: true })}
            >
              Usar este precio
            </Button>
          )}
        </div>
      </FormSection>

      <FormSection title="Inventario" description="Cómo se controlan las existencias y los lotes.">
        <SelectField label="Control de existencias" registration={register('tracks_stock')}>
          <option value="inherit">Usar la categoría ({inheritedTracksStock ? 'sí' : 'no'})</option>
          <option value="yes">Sí, llevar stock</option>
          <option value="no">No controlar existencias</option>
        </SelectField>
        <div className="space-y-3 pt-1 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('track_lots')} />
            Control de lotes
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('track_expiration')} />
            Control de caducidad
          </label>
        </div>
      </FormSection>

      <FormSection title="Avisos" description="Cuándo debe llamar la atención este producto.">
        <fieldset
          disabled={!canManageNotifications}
          className="space-y-3 rounded-lg border border-slate-200 p-4 disabled:opacity-70 sm:col-span-2"
        >
          <legend className="px-1 font-bold text-slate-900">Aviso de stock</legend>
          {!effectiveTracksStock ? (
            <p className="text-sm text-slate-600">
              No disponible porque este producto no controla existencias.
            </p>
          ) : (
            <>
              <Radio
                registration={register('stock_alert_mode')}
                value="GENERAL"
                label="Usar mínimo general"
                detail={`Actualmente: ${formatQuantity(generalStockMinimum)} unidades`}
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
                    htmlFor="product-min-stock"
                    error={errors.min_stock?.message ?? null}
                  >
                    <Input id="product-min-stock" inputMode="decimal" {...register('min_stock')} />
                  </FormField>
                </div>
              )}
              <Radio
                registration={register('stock_alert_mode')}
                value="DISABLED"
                label="No avisar por stock"
              />
            </>
          )}
          {!canManageNotifications && effectiveTracksStock && (
            <p className="text-sm text-slate-500">
              Usará el mínimo general. Tu perfil no puede modificar avisos.
            </p>
          )}
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4 sm:col-span-2">
          <legend className="px-1 font-bold text-slate-900">Aviso de caducidad</legend>
          {!trackExpiration ? (
            <p className="text-sm text-slate-600">
              Activa el control de caducidad para configurar avisos.
            </p>
          ) : !canManageNotifications ? (
            <p className="text-sm text-slate-600">
              Usará la configuración general. Tu perfil no puede modificar avisos.
            </p>
          ) : (
            <>
              <Radio
                registration={register('expiration_alert_mode')}
                value="GENERAL"
                label="Usar configuración general"
                detail={`Actualmente: ${generalExpirationDays} días antes`}
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
                    htmlFor="product-expiration-days"
                    hint="Días de antelación."
                  >
                    <Input
                      id="product-expiration-days"
                      type="number"
                      min={0}
                      max={365}
                      {...register('expiration_days')}
                    />
                  </FormField>
                </div>
              )}
            </>
          )}
        </fieldset>
      </FormSection>

      {submitError && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {submitError}
        </p>
      )}
      <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-100/95 py-4 backdrop-blur">
        <Button variant="ghost" onClick={cancelWithConfirm(isDirty, onCancel)} disabled={isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creando…' : 'Crear producto'}
        </Button>
      </div>
    </form>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function SelectField({
  label,
  registration,
  error,
  children,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="text-sm font-semibold text-slate-700">
      {label}
      <select
        {...registration}
        className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-slate-900"
      >
        {children}
      </select>
      {error && <span className="mt-1 block text-sm font-medium text-red-700">{error}</span>}
    </label>
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
