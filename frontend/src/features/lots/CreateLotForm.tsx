import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, Button, Card, FormField, Input } from '@/components/ui';
import { type Product } from '@/features/catalog/api';
import { type LotCreateInput } from '@/features/lots/api';
import { type Supplier } from '@/features/suppliers/api';

const createLotSchema = z.object({
  product_id: z.string().min(1, 'Elige un producto.'),
  lot_number: z.string().min(1, 'Introduce un número de lote.').max(100),
  manufacturing_date: z.string().optional(),
  expiration_date: z.string().optional(),
  supplier_id: z.string().optional(),
});

type CreateLotFormValues = z.infer<typeof createLotSchema>;

interface CreateLotFormProps {
  products: Product[];
  suppliers: Supplier[];
  initialProductId?: number | null;
  onSubmit: (payload: LotCreateInput) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

export function CreateLotForm({
  products,
  suppliers,
  initialProductId = null,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateLotFormProps) {
  const trackedProducts = useMemo(
    () => products.filter((product) => product.is_active && product.track_lots),
    [products],
  );
  const requestedProduct = trackedProducts.find((product) => product.id === initialProductId);
  const automaticProduct =
    requestedProduct ?? (trackedProducts.length === 1 ? trackedProducts[0]! : null);
  const automaticProductId = automaticProduct?.id ?? null;
  const [productSearch, setProductSearch] = useState('');
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateLotFormValues>({
    resolver: zodResolver(createLotSchema),
    defaultValues: {
      product_id: automaticProductId === null ? '' : String(automaticProductId),
      lot_number: '',
      manufacturing_date: '',
      expiration_date: '',
      supplier_id: '',
    },
  });

  useEffect(() => {
    if (automaticProductId === null) return;
    setValue('product_id', String(automaticProductId));
    if (automaticProduct) setProductSearch((current) => current || automaticProduct.name);
  }, [automaticProduct, automaticProductId, setValue]);

  const selectedProductId = watch('product_id');
  const selectedProduct = trackedProducts.find(
    (product) => product.id === Number(selectedProductId),
  );
  const normalizedSearch = productSearch.trim().toLocaleLowerCase('es');
  const visibleProducts =
    selectedProduct === undefined && normalizedSearch !== ''
      ? trackedProducts
          .filter((product) => product.name.toLocaleLowerCase('es').includes(normalizedSearch))
          .slice(0, 8)
      : [];

  const submit = handleSubmit((values) => {
    onSubmit({
      product_id: Number(values.product_id),
      lot_number: values.lot_number.trim(),
      manufacturing_date: values.manufacturing_date || null,
      expiration_date: values.expiration_date || null,
      supplier_id: values.supplier_id ? Number(values.supplier_id) : null,
      purchase_order_id: null,
    });
  });

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Nuevo lote</h2>
          <p className="mt-1 text-sm text-slate-600">
            Elige un producto que controle lotes e introduce los datos de la etiqueta.
          </p>
        </div>

        {submitError && <Alert tone="error">{submitError}</Alert>}

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <FormField
              label="Producto"
              htmlFor="lot-product-search"
              error={errors.product_id?.message ?? null}
              hint={
                selectedProduct
                  ? `Seleccionado: ${selectedProduct.name}`
                  : 'Escribe el nombre y elige uno de los resultados.'
              }
            >
              <Input
                id="lot-product-search"
                type="search"
                value={productSearch}
                autoComplete="off"
                onChange={(event) => {
                  setProductSearch(event.target.value);
                  setValue('product_id', '', { shouldValidate: true });
                }}
                placeholder="Buscar producto…"
              />
            </FormField>
            <input type="hidden" {...register('product_id')} />
            {visibleProducts.length > 0 && (
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                {visibleProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    aria-label={`Elegir ${product.name}`}
                    onClick={() => {
                      setValue('product_id', String(product.id), { shouldValidate: true });
                      setProductSearch(product.name);
                    }}
                    className="block w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm font-medium text-slate-800 last:border-b-0 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                  >
                    {product.name}
                  </button>
                ))}
              </div>
            )}
            {normalizedSearch !== '' &&
              selectedProduct === undefined &&
              visibleProducts.length === 0 && (
                <p className="mt-2 text-sm text-slate-500">
                  No hay productos activos con control de lotes para esa búsqueda.
                </p>
              )}
          </div>

          <FormField
            label="Número de lote"
            htmlFor="lot-number"
            error={errors.lot_number?.message ?? null}
          >
            <Input id="lot-number" {...register('lot_number')} />
          </FormField>

          <FormField
            label="Fecha de caducidad"
            htmlFor="lot-expiration"
            hint={
              selectedProduct?.track_expiration
                ? 'Este producto controla caducidad; revisa la fecha de la etiqueta.'
                : 'Opcional para este producto.'
            }
          >
            <Input id="lot-expiration" type="date" {...register('expiration_date')} />
          </FormField>

          <FormField label="Proveedor" htmlFor="lot-supplier">
            <select
              id="lot-supplier"
              {...register('supplier_id')}
              className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Sin proveedor</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <details className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Opciones menos frecuentes
          </summary>
          <div className="mt-4 max-w-sm">
            <FormField label="Fecha de fabricación" htmlFor="lot-manufacturing">
              <Input id="lot-manufacturing" type="date" {...register('manufacturing_date')} />
            </FormField>
          </div>
        </details>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-5">
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || trackedProducts.length === 0}>
            {isPending ? 'Creando…' : 'Crear lote'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
