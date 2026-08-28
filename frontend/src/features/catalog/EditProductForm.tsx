import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button, Card, FormField, Input } from '@/components/ui';
import {
  type PosCategory,
  type Product,
  type ProductCategory,
  type ProductUpdateInput,
  type Unit,
} from '@/features/catalog/api';
import { cancelWithConfirm, useUnsavedWarning } from '@/lib/unsaved';

const editProductSchema = z.object({
  name: z.string().min(1, 'Introduce un nombre.').max(255),
  description: z.string().max(2000).optional(),
  category_id: z.string(),
  pos_category_id: z.string(),
  pos_display_order: z.coerce.number().int().min(0),
  is_open_price: z.boolean(),
  base_barcode: z.string().max(64).optional(),
  base_unit_name: z.string().min(1, 'Elige una unidad base.'),
});

type EditProductFormValues = z.infer<typeof editProductSchema>;

interface EditProductFormProps {
  product: Product;
  categories: ProductCategory[];
  posCategories: PosCategory[];
  units: Unit[];
  onSubmit: (payload: ProductUpdateInput) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
  onDirtyChange?: (isDirty: boolean) => void;
}

export function EditProductForm({
  product,
  categories,
  posCategories,
  units,
  onSubmit,
  onCancel,
  isPending,
  submitError,
  onDirtyChange,
}: EditProductFormProps) {
  const baseBarcode = product.packages.find((item) => item.is_base)?.barcodes[0]?.barcode ?? '';
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<EditProductFormValues>({
    resolver: zodResolver(editProductSchema),
    defaultValues: {
      name: product.name,
      description: product.description,
      category_id: product.category_id === null ? '' : String(product.category_id),
      pos_category_id: product.pos_category_id === null ? '' : String(product.pos_category_id),
      pos_display_order: product.pos_display_order,
      is_open_price: product.is_open_price ?? false,
      base_barcode: baseBarcode,
      base_unit_name: product.base_unit_name,
    },
  });

  useUnsavedWarning(isDirty);
  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange]);

  const submit = handleSubmit((values) =>
    onSubmit({
      name: values.name,
      description: values.description ?? '',
      category_id: values.category_id ? Number(values.category_id) : null,
      pos_category_id: values.pos_category_id ? Number(values.pos_category_id) : null,
      pos_display_order: values.pos_display_order,
      is_open_price: values.is_open_price,
      base_barcode: values.base_barcode?.trim() || null,
      base_unit_name: values.base_unit_name,
    }),
  );

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className="space-y-5">
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-slate-900">Información general</h2>
        <p className="mt-1 text-sm text-slate-600">
          Nombre, organización y datos visibles en la tienda.
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <FormField
            label="Nombre"
            htmlFor="edit-product-name"
            error={errors.name?.message ?? null}
          >
            <Input id="edit-product-name" {...register('name')} />
          </FormField>
          <FormField
            label="Código de barras"
            htmlFor="edit-product-barcode"
            hint="Código principal del formato base."
          >
            <Input id="edit-product-barcode" {...register('base_barcode')} />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Descripción" htmlFor="edit-product-description">
              <Input id="edit-product-description" {...register('description')} />
            </FormField>
          </div>
          <label className="text-sm font-semibold text-slate-700">
            Categoría
            <select
              {...register('category_id')}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
            >
              <option value="">Sin categoría</option>
              {categories
                .filter((item) => item.is_active || item.id === product.category_id)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Categoría POS
            <select
              {...register('pos_category_id')}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
            >
              <option value="">Sin categoría POS</option>
              {posCategories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Unidad base
            <select
              {...register('base_unit_name')}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
            >
              {!units.some((item) => item.name === product.base_unit_name) && (
                <option value={product.base_unit_name}>{product.base_unit_name}</option>
              )}
              {units.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
            {errors.base_unit_name && (
              <span className="mt-1 block text-sm text-red-700">
                {errors.base_unit_name.message}
              </span>
            )}
          </label>
          <FormField label="Orden en el TPV" htmlFor="edit-product-order">
            <Input
              id="edit-product-order"
              type="number"
              min={0}
              {...register('pos_display_order')}
            />
          </FormField>
          <label className="flex items-start gap-3 text-sm text-slate-700 sm:col-span-2">
            <input type="checkbox" className="mt-1" {...register('is_open_price')} />
            <span>
              <strong className="block">Precio libre en TPV</strong>El importe se pedirá al añadir
              este producto a la venta.
            </span>
          </label>
        </div>
      </Card>
      {submitError && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {submitError}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={cancelWithConfirm(isDirty, onCancel)} disabled={isPending}>
          Descartar
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}
