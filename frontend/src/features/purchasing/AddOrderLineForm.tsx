import { zodResolver } from '@hookform/resolvers/zod';
import { useId } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Product } from '@/features/catalog/api';
import { useChosenProduct } from '@/features/catalog/useChosenProduct';
import { useProductSearch } from '@/features/catalog/useProductSearch';
import { type OrderLineInput } from '@/features/purchasing/api';
import { decimalInputValue, decimalString } from '@/lib/decimal';

const addLineSchema = z.object({
  product_id: z.string().min(1, 'Elige un producto.'),
  package_id: z.string().min(1, 'Elige un formato.'),
  quantity_packages: decimalString({ min: 0.000001 }),
  unit_cost: decimalString({ min: 0 }),
  tax_rate: decimalString({ min: 0 }),
  discount_rate: decimalString({ min: 0 }),
});

type AddLineFormValues = z.infer<typeof addLineSchema>;

interface AddOrderLineFormProps {
  products: Product[];
  onSubmit: (payload: OrderLineInput) => void;
  isPending: boolean;
}

/** Formulario para añadir una línea a un pedido en `DRAFT` — la presentación
 * se elige de las del producto seleccionado (`product.packages`), igual que
 * en el TPV. */
export function AddOrderLineForm({ products, onSubmit, isPending }: AddOrderLineFormProps) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<AddLineFormValues>({
    resolver: zodResolver(addLineSchema),
    defaultValues: {
      product_id: '',
      package_id: '',
      quantity_packages: '1',
      unit_cost: '0',
      tax_rate: '0',
      discount_rate: '0',
    },
  });

  const productId = watch('product_id');
  const productFieldId = useId();
  const { query, setQuery, matches } = useProductSearch(products, {
    onSingleMatch: (id) => setValue('product_id', id),
  });
  // El IVA sale ya puesto con el del producto (el suyo, o el de su
  // categoría — el backend lo resuelve en `effective_tax_rate`), pero se
  // puede cambiar: una factura de compra puede traer otro tipo.
  const selectedProduct = useChosenProduct(productId, products, (product) =>
    setValue('tax_rate', decimalInputValue(product.effective_tax_rate)),
  );

  const submit = handleSubmit((values) => {
    onSubmit({
      product_id: Number(values.product_id),
      package_id: Number(values.package_id),
      quantity_packages: values.quantity_packages,
      unit_cost: values.unit_cost,
      tax_rate: values.tax_rate,
      discount_rate: values.discount_rate,
    });
    reset({
      product_id: '',
      package_id: '',
      quantity_packages: '1',
      unit_cost: '0',
      tax_rate: '0',
      discount_rate: '0',
    });
  });

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      className="flex flex-wrap items-end gap-2"
    >
      <div className="text-sm text-slate-600">
        <label htmlFor={productFieldId}>Producto</label>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nombre o código de barras…"
          aria-label="Buscar producto"
          className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          id={productFieldId}
          className="mt-1 block w-48 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('product_id')}
        >
          <option value="">Elige un producto…</option>
          {matches.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
        {errors.product_id && (
          <p className="mt-1 text-sm text-red-600">{errors.product_id.message}</p>
        )}
      </div>

      <label className="text-sm text-slate-600">
        Formato
        <select
          className="mt-1 block w-32 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('package_id')}
        >
          <option value="">Elige…</option>
          {(selectedProduct?.packages ?? []).map((pkg) => (
            <option key={pkg.id} value={pkg.id}>
              {pkg.name}
            </option>
          ))}
        </select>
        {errors.package_id && (
          <p className="mt-1 text-sm text-red-600">{errors.package_id.message}</p>
        )}
      </label>

      <label className="text-sm text-slate-600">
        Cantidad
        <input
          type="text"
          inputMode="decimal"
          className="mt-1 block w-20 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('quantity_packages')}
        />
        {errors.quantity_packages && (
          <p className="mt-1 text-sm text-red-600">{errors.quantity_packages.message}</p>
        )}
      </label>

      <label className="text-sm text-slate-600">
        Coste/ud.
        <input
          type="text"
          inputMode="decimal"
          className="mt-1 block w-24 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('unit_cost')}
        />
        {errors.unit_cost && (
          <p className="mt-1 text-sm text-red-600">{errors.unit_cost.message}</p>
        )}
      </label>

      {/* Lo que ese producto vale hoy, para poder comparar con lo que pide
          el proveedor sin abrir su ficha. Sólo de lectura: el coste de la
          izquierda es el de esta compra, y el PVP se cambia desde la lista
          de productos. */}
      <label className="text-sm text-slate-600">
        Coste actual
        <input
          type="text"
          readOnly
          value={selectedProduct ? decimalInputValue(selectedProduct.cost) : ''}
          placeholder="—"
          className="mt-1 block w-24 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600"
        />
      </label>

      <label className="text-sm text-slate-600">
        PVP actual
        <input
          type="text"
          readOnly
          value={selectedProduct ? decimalInputValue(selectedProduct.list_price) : ''}
          placeholder="—"
          className="mt-1 block w-24 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600"
        />
      </label>

      <label className="text-sm text-slate-600">
        IVA %
        <input
          type="text"
          inputMode="decimal"
          className="mt-1 block w-16 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('tax_rate')}
        />
      </label>

      <label className="text-sm text-slate-600">
        Dto. %
        <input
          type="text"
          inputMode="decimal"
          className="mt-1 block w-16 rounded border border-slate-300 px-3 py-1.5 text-sm"
          {...register('discount_rate')}
        />
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-brand-700 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Añadiendo…' : 'Añadir línea'}
      </button>
    </form>
  );
}
