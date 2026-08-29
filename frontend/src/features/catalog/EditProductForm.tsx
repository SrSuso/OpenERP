import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  type Product,
  type ProductCategory,
  type ProductUpdateInput,
  type PosCategory,
  type Unit,
} from '@/features/catalog/api';
import { decimalString } from '@/lib/decimal';
import { cancelWithConfirm, useUnsavedWarning } from '@/lib/unsaved';

// Mirrors backend/app/catalog/schemas.py's ProductUpdate exactly — no
// cost/price/tax here on purpose, see that schema's own docstring
// (features/pricing, a later module, is the only write path for those).
const editProductSchema = z.object({
  name: z.string().min(1, 'Introduce un nombre.').max(255),
  description: z.string().max(2000).optional(),
  category_id: z.string(),
  pos_category_id: z.string(),
  pos_display_order: z.coerce.number().int().min(0),
  is_open_price: z.boolean(),
  base_barcode: z.string().max(64).optional(),
  base_unit_name: z.string().min(1, 'Elige una unidad base.'),
  min_stock: decimalString({ min: 0 }),
  track_lots: z.boolean(),
  track_expiration: z.boolean(),
  // Tres estados: heredar de la categoría, o decirlo aquí.
  tracks_stock: z.enum(['inherit', 'yes', 'no']),
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
  const basePackage = product.packages.find((item) => item.is_base);
  const baseBarcode = basePackage?.barcodes[0]?.barcode ?? '';
  // Para poder decir en el desplegable qué se hereda exactamente.
  const inheritedTracksStock =
    categories.find((category) => category.id === product.category_id)?.tracks_stock ?? null;
  // La interfaz comercial reúne lote y caducidad en una única opción. Una
  // ficha histórica que sólo tuviera lotes se muestra activada para no
  // ocultar su trazabilidad al editarla.
  const tracksExpiryAndLots = product.track_lots || product.track_expiration;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
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
      min_stock: product.min_stock,
      track_lots: tracksExpiryAndLots,
      track_expiration: tracksExpiryAndLots,
      tracks_stock: product.tracks_stock === null ? 'inherit' : product.tracks_stock ? 'yes' : 'no',
    },
  });

  const tracksExpiration = watch('track_expiration');

  // La única opción visible gobierna ambos campos que necesita el backend.
  // La caducidad siempre exige lote y existencias.
  useEffect(() => {
    setValue('track_lots', tracksExpiration);
    if (tracksExpiration) {
      setValue('tracks_stock', 'yes');
    }
  }, [setValue, tracksExpiration]);

  useUnsavedWarning(isDirty);

  // La ficha vive dentro de una pestaña: el padre necesita saber si puede
  // desmontarla sin perder lo que se está editando.
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const submit = handleSubmit((values) =>
    onSubmit({
      name: values.name,
      description: values.description ?? '',
      category_id: values.category_id === '' ? null : Number(values.category_id),
      pos_category_id: values.pos_category_id === '' ? null : Number(values.pos_category_id),
      pos_display_order: values.pos_display_order,
      is_open_price: values.is_open_price,
      base_barcode: values.base_barcode?.trim() || null,
      base_unit_name: values.base_unit_name,
      min_stock: values.min_stock,
      track_lots: values.track_lots,
      track_expiration: values.track_expiration,
      ...(values.tracks_stock === 'inherit'
        ? { inherit_tracks_stock: true }
        : { tracks_stock: values.tracks_stock === 'yes' }),
    }),
  );

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-4"
    >
      <h4 className="mb-3 text-sm font-semibold text-slate-700">Editar «{product.name}»</h4>

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
          Orden en el TPV
          <input
            type="number"
            min={0}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('pos_display_order')}
          />
          <span className="mt-1 block text-xs text-slate-400">
            Solo ordena el botón en su categoría POS: 1 es el primero; 0 va siempre al final.
          </span>
        </label>

        <label className="text-sm text-slate-600 sm:col-span-3">
          Descripción
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('description')}
          />
        </label>

        <div className="text-sm text-slate-600">
          <label>
            Código de barras
            <input
              type="text"
              inputMode="numeric"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('base_barcode')}
            />
          </label>
          <span className="mt-1 block text-xs text-slate-400">
            Código principal del formato base. Los adicionales se gestionan en Formatos.
          </span>
          {errors.base_barcode && (
            <p className="mt-1 text-sm text-red-600">{errors.base_barcode.message}</p>
          )}
        </div>

        <label className="text-sm text-slate-600">
          Categoría
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('category_id')}
          >
            <option value="">Sin categoría</option>
            {/* Una categoría oculta deja de ofrecerse, pero sigue visible
                si es la que el producto ya tenía: si no, parecería que no
                tiene ninguna. */}
            {categories
              .filter((category) => category.is_active || category.id === product.category_id)
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

        <div className="text-sm text-slate-600">
          <label>
            Unidad base
            <select
              className="mt-1 block w-full rounded border border-slate-300 px-3 py-2 text-sm"
              {...register('base_unit_name')}
            >
              {/* Un producto antiguo puede conservar una unidad que aún no
                  se haya añadido a la lista; mantenerla visible evita que
                  editar otro campo cambie la selección por accidente. */}
              {!units.some((unit) => unit.name === product.base_unit_name) && (
                <option value={product.base_unit_name}>{product.base_unit_name}</option>
              )}
              {units.map((unit) => (
                <option key={unit.id} value={unit.name}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <span className="mt-1 block text-xs text-slate-400">
            Puedes corregirla aunque ya tenga historial. Es una corrección de etiqueta: no convierte
            cantidades, precios ni movimientos ya registrados.
          </span>
          {errors.base_unit_name && (
            <p className="mt-1 text-sm text-red-600">{errors.base_unit_name.message}</p>
          )}
        </div>

        {/* La ayuda va fuera del <label>: dentro pasaría a formar parte
            del nombre accesible del desplegable. */}
        <div className="text-sm text-slate-600 sm:col-span-2">
          <label>
            Control de existencias
            <select
              className="mt-1 block w-64 rounded border border-slate-300 px-3 py-2 text-sm"
              disabled={tracksExpiration}
              {...register('tracks_stock')}
            >
              <option value="inherit">
                Lo que diga su categoría{' '}
                {inheritedTracksStock === null ? '' : inheritedTracksStock ? '(sí)' : '(no)'}
              </option>
              <option value="yes">Sí, llevar stock</option>
              <option value="no">No, no se agota nunca</option>
            </select>
          </label>
          <span className="mt-1 block text-xs text-slate-400">
            «No se agota» es para lo que se repone del saco sin contarlo: se vende sin comprobar ni
            descontar existencias, así que la caja nunca se planta por falta de stock.
          </span>
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <p className="text-xs font-medium uppercase text-slate-500">Trazabilidad</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" {...register('track_expiration')} />
              Control de caducidad y lotes
            </label>
            <p className="text-xs text-slate-400">
              Al activarlo se guardan lote y fecha de caducidad, y se lleva control de existencias.
            </p>
          </div>
        </div>

        <div className="text-sm text-slate-600 sm:col-span-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" {...register('is_open_price')} />
            Precio libre en TPV
          </label>
          <p className="mt-1 text-xs text-slate-400">
            El botón pedirá el importe total al venderlo. El nombre que edites aquí se verá en caja
            y en el ticket.
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
          {isPending ? 'Guardando…' : 'Guardar'}
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
