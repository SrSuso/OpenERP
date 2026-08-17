import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  type PosCategory,
  type ProductCategory,
  type ProductCreateInput,
  type Unit,
} from '@/features/catalog/api';
import { previewFormula, type Tax } from '@/features/pricing/api';
import { TaxChips } from '@/features/pricing/TaxChips';
import { decimalString } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';
import { cancelWithConfirm, useUnsavedWarning } from '@/lib/unsaved';

// Mirrors backend/app/catalog/schemas.py's ProductCreate — sin sku (lo
// genera el backend) ni tax_rate (los impuestos se eligen del catálogo de
// Precios, nunca un número suelto aquí). surcharge_rate/price_formula
// quedan fuera a propósito, igual que antes.
const createProductSchema = z.object({
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
  margin_rate: z.string(), // vacío = hereda de la categoría; validado abajo si no está vacío
  margin_amount: z.string(), // igual, pero en euros sobre el coste
  min_stock: decimalString({ min: 0 }),
  track_lots: z.boolean(),
  track_expiration: z.boolean(),
});

type CreateProductFormValues = z.infer<typeof createProductSchema>;

interface CreateProductFormProps {
  categories: ProductCategory[];
  posCategories: PosCategory[];
  units: Unit[];
  taxes: Tax[];
  /** `taxIds` va aparte de `ProductCreateInput`: el alta en sí no lleva
   * impuestos (backend/app/catalog/schemas.py's ProductCreate no los
   * acepta — impuestos es cosa de app.pricing) — quien llama hace un
   * PATCH .../pricing justo después si se eligió alguno. */
  onSubmit: (payload: ProductCreateInput, taxIds: number[]) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

/** Suma de las tasas de los impuestos elegidos si hay alguno explícito;
 * si no, la de la categoría — exactamente la prioridad que resuelve
 * app.pricing.service.effective_tax_rate una vez el producto existe. */
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
  const category = categories.find((c) => String(c.id) === categoryId);
  if (!category) return '0';
  return category.taxes.reduce((sum, tax) => sum + Number(tax.rate), 0).toString();
}

function categoryMarginRate(categories: ProductCategory[], categoryId: string): string {
  const category = categories.find((c) => String(c.id) === categoryId);
  return category?.margin_rate ?? '0';
}

function categoryMarginAmount(categories: ProductCategory[], categoryId: string): string {
  const category = categories.find((c) => String(c.id) === categoryId);
  return category?.margin_amount ?? '0';
}

export function CreateProductForm({
  categories,
  posCategories,
  units,
  taxes,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateProductFormProps) {
  // `taxIds` es lo que de verdad se manda (vacío = sigue heredando, ver
  // onSubmit más abajo); `isOverride` distingue "nunca lo ha tocado" de
  // "ha elegido explícitamente estos" — mientras no lo toque, los chips
  // muestran marcados los de la categoría (displayedTaxIds), para que no
  // parezca que no se aplica ningún impuesto, pero taxIds sigue vacío.
  const [isOverride, setIsOverride] = useState(false);
  const [taxIds, setTaxIds] = useState<Set<number>>(new Set());

  // Al elegir uno se pasa a "propios de este producto" aunque coincida con
  // el de la categoría: tocar los chips es un gesto explícito.
  function chooseTax(next: Set<number>) {
    setTaxIds(next);
    setIsOverride(true);
  }
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
      min_stock: '0',
      track_lots: false,
      track_expiration: false,
    },
  });

  const cost = watch('cost');
  const marginInput = watch('margin_rate');
  const amountInput = watch('margin_amount');
  const categoryId = watch('category_id');
  const [estimatedPrice, setEstimatedPrice] = useState<string | null>(null);

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
        // Sin fórmula propia (el producto todavía no existe): usa la
        // fórmula por defecto de la tienda para que la vista previa sea
        // exactamente lo que el backend calcularía al guardar el margen.
        formula:
          '(cost + cost * tax_rate / 100 + cost * surcharge_rate / 100) * (1 + margin_rate / 100)',
        cost: input.cost,
        tax_rate: input.tax_rate,
        surcharge_rate: '0',
        margin_rate: input.margin_rate,
        margin_amount: input.margin_amount,
      }),
    onSuccess: (result) => setEstimatedPrice(result),
    onError: () => setEstimatedPrice(null),
  });

  useEffect(() => {
    const marginRate =
      marginInput.trim() !== '' ? marginInput : categoryMarginRate(categories, categoryId);
    const marginAmount =
      amountInput.trim() !== '' ? amountInput : categoryMarginAmount(categories, categoryId);
    const taxRate = effectiveTaxRatePreview(categories, categoryId, taxes, taxIds);
    if (!cost || Number.isNaN(Number(cost.replace(',', '.')))) {
      setEstimatedPrice(null);
      return;
    }
    const handle = setTimeout(() => {
      previewMutation.mutate({
        cost: cost.replace(',', '.'),
        margin_rate: marginRate,
        margin_amount: marginAmount.replace(',', '.'),
        tax_rate: taxRate,
      });
    }, 300);
    return () => clearTimeout(handle);
    // previewMutation is stable (useMutation) but including it would
    // re-run this effect on every render (its identity isn't memoised) —
    // deliberately left out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cost, marginInput, amountInput, categoryId, categories, taxes, taxIds]);

  const categoryTaxIds = new Set(
    (categories.find((c) => String(c.id) === categoryId)?.taxes ?? []).map((t) => t.id),
  );
  const displayedTaxIds = isOverride ? taxIds : categoryTaxIds;

  useUnsavedWarning(isDirty);

  const submit = handleSubmit((values) =>
    onSubmit(
      {
        name: values.name,
        description: values.description ?? '',
        category_id: values.category_id === '' ? null : Number(values.category_id),
        pos_category_id: values.pos_category_id === '' ? null : Number(values.pos_category_id),
        pos_display_order: values.pos_display_order,
        is_open_price: values.is_open_price,
        base_unit_name: values.base_unit_name,
        base_barcode: values.base_barcode === '' ? null : (values.base_barcode ?? null),
        cost: values.cost,
        list_price: values.list_price,
        margin_rate: values.margin_rate.trim() === '' ? null : values.margin_rate,
        margin_amount: values.margin_amount.trim() === '' ? null : values.margin_amount,
        min_stock: values.min_stock,
        track_lots: values.track_lots,
        track_expiration: values.track_expiration,
      },
      [...taxIds],
    ),
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nuevo producto</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600 sm:col-span-2">
          Nombre
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('name')}
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          Unidad base
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('base_unit_name')}
          >
            <option value="" disabled>
              Elige una unidad…
            </option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.name}>
                {unit.name}
              </option>
            ))}
          </select>
          {errors.base_unit_name && (
            <p className="mt-1 text-sm text-red-600">{errors.base_unit_name.message}</p>
          )}
          {units.length === 0 && (
            <p className="mt-1 text-xs text-slate-400">
              No hay unidades todavía — créalas en la pestaña Categorías.
            </p>
          )}
        </label>

        <label className="text-sm text-slate-600 sm:col-span-3">
          Descripción (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('description')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Categoría (estantería)
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('category_id')}
          >
            <option value="">Sin categoría</option>
            {/* Una categoría oculta deja de ofrecerse, pero sigue visible
                si es la que el producto ya tenía: si no, parecería que no
                tiene ninguna. */}
            {categories
              .filter((category) => category.is_active || String(category.id) === categoryId)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Categoría POS
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('pos_category_id')}
          >
            <option value="">Sin categoría POS</option>
            {posCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-600">
          Orden en el TPV
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('pos_display_order')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Código de barras (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('base_barcode')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Coste
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('cost')}
          />
          {errors.cost && <p className="mt-1 text-sm text-red-600">{errors.cost.message}</p>}
        </label>

        <label className="text-sm text-slate-600">
          Margen (%, vacío = el de la categoría)
          <input
            type="text"
            inputMode="decimal"
            placeholder={
              categoryMarginRate(categories, categoryId) === '0'
                ? ''
                : categoryMarginRate(categories, categoryId)
            }
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('margin_rate')}
          />
        </label>

        <label className="text-sm text-slate-600">
          Margen fijo (€, vacío = el de la categoría)
          <input
            type="text"
            inputMode="decimal"
            placeholder={
              categoryMarginAmount(categories, categoryId) === '0'
                ? 'p. ej. 0,25'
                : categoryMarginAmount(categories, categoryId)
            }
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('margin_amount')}
          />
        </label>

        <div className="text-sm text-slate-600 sm:col-span-3">
          <span className="mb-1 block">
            Impuestos —{' '}
            {isOverride
              ? 'propios de este producto'
              : `heredados de "${categories.find((c) => String(c.id) === categoryId)?.name ?? 'sin categoría'}" (marcados igualmente, para que se vea que sí se aplican)`}
          </span>
          <TaxChips taxes={taxes} selected={displayedTaxIds} onChange={chooseTax} />
        </div>

        <div className="text-sm text-slate-600">
          <span className="block">PVP estimado</span>
          <p className="mt-1 rounded border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {estimatedPrice ? formatMoney(estimatedPrice) : '—'}
          </p>
          {estimatedPrice && (
            <button
              type="button"
              onClick={() => setValue('list_price', estimatedPrice)}
              className="mt-1 text-xs font-medium text-brand-700 hover:underline"
            >
              Usar este precio
            </button>
          )}
        </div>

        <label className="text-sm text-slate-600">
          Precio de venta
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('list_price')}
          />
          {errors.list_price && (
            <p className="mt-1 text-sm text-red-600">{errors.list_price.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600">
          Stock mínimo
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('min_stock')}
          />
          {errors.min_stock && (
            <p className="mt-1 text-sm text-red-600">{errors.min_stock.message}</p>
          )}
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" {...register('track_lots')} />
          Controla lotes
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" {...register('track_expiration')} />
          Controla caducidad
        </label>

        <div className="text-sm text-slate-600 sm:col-span-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('is_open_price')} />
            Precio libre en TPV
          </label>
          <p className="mt-1 text-xs text-slate-400">
            Al pulsar este botón en caja se pedirá el importe total. El nombre del producto será el
            que aparezca en el carrito y en el ticket.
          </p>
        </div>
      </div>

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Creando…' : 'Crear'}
        </button>
        <button
          type="button"
          onClick={cancelWithConfirm(isDirty, onCancel)}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
