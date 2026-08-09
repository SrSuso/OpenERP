import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  type ProductCategory,
  type ProductCreateInput,
  type PosCategory,
} from '@/features/catalog/api';
import { decimalString } from '@/lib/decimal';

// Mirrors backend/app/catalog/schemas.py's ProductCreate. surcharge_rate/
// margin_rate/price_formula are left out on purpose — they default to 0
// server-side and, from here on, only `features/pricing` (a later module)
// writes them.
const createProductSchema = z.object({
  sku: z.string().min(1, 'Introduce un SKU.').max(50),
  name: z.string().min(1, 'Introduce un nombre.').max(255),
  description: z.string().max(2000).optional(),
  category_id: z.string(),
  pos_category_id: z.string(),
  pos_display_order: z.coerce.number().int().min(0),
  base_unit_name: z.string().min(1, 'Introduce la unidad base (p.ej. UNIT, KG).').max(20),
  base_barcode: z.string().max(64).optional(),
  cost: decimalString({ min: 0 }),
  list_price: decimalString({ min: 0 }),
  tax_rate: decimalString({ min: 0 }),
  min_stock: decimalString({ min: 0 }),
  track_lots: z.boolean(),
  track_expiration: z.boolean(),
});

type CreateProductFormValues = z.infer<typeof createProductSchema>;

interface CreateProductFormProps {
  categories: ProductCategory[];
  posCategories: PosCategory[];
  onSubmit: (payload: ProductCreateInput) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

export function CreateProductForm({
  categories,
  posCategories,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateProductFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateProductFormValues>({
    resolver: zodResolver(createProductSchema),
    defaultValues: {
      category_id: '',
      pos_category_id: '',
      pos_display_order: 0,
      cost: '0',
      list_price: '0',
      tax_rate: '0',
      min_stock: '0',
      track_lots: false,
      track_expiration: false,
    },
  });

  const submit = handleSubmit((values) =>
    onSubmit({
      sku: values.sku,
      name: values.name,
      description: values.description ?? '',
      category_id: values.category_id === '' ? null : Number(values.category_id),
      pos_category_id: values.pos_category_id === '' ? null : Number(values.pos_category_id),
      pos_display_order: values.pos_display_order,
      base_unit_name: values.base_unit_name,
      base_barcode: values.base_barcode === '' ? null : (values.base_barcode ?? null),
      cost: values.cost,
      list_price: values.list_price,
      tax_rate: values.tax_rate,
      min_stock: values.min_stock,
      track_lots: values.track_lots,
      track_expiration: values.track_expiration,
    }),
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nuevo producto</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          SKU
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('sku')}
          />
          {errors.sku && <p className="mt-1 text-sm text-red-600">{errors.sku.message}</p>}
        </label>

        <label className="text-sm text-slate-600 sm:col-span-2">
          Nombre
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('name')}
          />
          {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>}
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
            {categories.map((category) => (
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
          Unidad base
          <input
            type="text"
            placeholder="UNIT, KG, BRIK…"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('base_unit_name')}
          />
          {errors.base_unit_name && (
            <p className="mt-1 text-sm text-red-600">{errors.base_unit_name.message}</p>
          )}
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
          IVA (tasa, p.ej. 0.21)
          <input
            type="text"
            inputMode="decimal"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('tax_rate')}
          />
          {errors.tax_rate && (
            <p className="mt-1 text-sm text-red-600">{errors.tax_rate.message}</p>
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
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
