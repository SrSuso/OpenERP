import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Product } from '@/features/catalog/api';
import { useChosenProduct } from '@/features/catalog/useChosenProduct';
import { useProductSearch } from '@/features/catalog/useProductSearch';
import { type OrderLineInput, type PurchaseOrderLine } from '@/features/purchasing/api';
import { previewProductPriceForCost } from '@/features/pricing/api';
import { decimalInputValue, decimalString } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';

const addLineSchema = z.object({
  product_id: z.string().min(1, 'Elige un producto.'),
  package_id: z.string().min(1, 'Elige un formato.'),
  quantity_packages: decimalString({ min: 0.000001 }),
  unit_cost: decimalString({ min: 0 }),
  tax_rate: decimalString({ min: 0 }),
  discount_rate: decimalString({ min: 0 }),
});

type AddLineFormValues = z.infer<typeof addLineSchema>;

export interface OrderLinePreview {
  product_name: string;
  unit_name: string;
  rounded_price: string | null;
}

interface AddOrderLineFormProps {
  products: Product[];
  onSubmit: (payload: OrderLineInput, preview: OrderLinePreview) => void;
  isPending: boolean;
  initialLine?: PurchaseOrderLine;
  submitLabel?: string;
  onCancel?: () => void;
}

/** Formulario para añadir una línea a un pedido en `DRAFT` — la unidad se
 * toma automáticamente de la unidad base del producto. */
export function AddOrderLineForm({
  products,
  onSubmit,
  isPending,
  initialLine,
  submitLabel = 'Añadir línea',
  onCancel,
}: AddOrderLineFormProps) {
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
      product_id: initialLine ? String(initialLine.product_id) : '',
      package_id: initialLine ? String(initialLine.package_id) : '',
      quantity_packages: initialLine?.quantity_packages ?? '1',
      unit_cost: initialLine?.unit_cost ?? '0',
      tax_rate: initialLine?.tax_rate ?? '0',
      discount_rate: initialLine?.discount_rate ?? '0',
    },
  });

  const productId = watch('product_id');
  const unitCost = watch('unit_cost');
  const productFieldId = useId();
  const { query, setQuery, matches } = useProductSearch(products, {
    onSingleMatch: (id) => setValue('product_id', id),
  });
  // El IVA y la unidad salen del producto: una línea de compra nunca debe
  // pedir elegir otra unidad distinta. Se conserva la posibilidad de cambiar
  // el IVA de factura, pero no la identidad física de lo que se compra.
  const selectedProduct = useChosenProduct(productId, products, (product) => {
    // Una línea existente conserva su instantánea: no convertimos una compra
    // histórica hecha por cajas a unidades sólo por abrir el editor. Al
    // elegir otro artículo sí se toma automáticamente su unidad base.
    if (initialLine?.product_id === product.id) return;
    const basePackage = product.packages.find((pkg) => pkg.is_base) ?? product.packages[0];
    setValue('package_id', basePackage ? String(basePackage.id) : '');
    setValue('tax_rate', decimalInputValue(product.effective_tax_rate));
    setValue('unit_cost', decimalInputValue(product.cost));
  });
  const selectedProductId = selectedProduct?.id;
  const selectedUnitName =
    initialLine !== undefined && initialLine.product_id === selectedProductId
      ? initialLine.package_name
      : selectedProduct?.base_unit_name;
  // Los campos monetarios aceptan la coma decimal española, pero `Number`
  // no. Normalízala antes de decidir si se puede pedir la previsualización y
  // antes de enviarla al backend, que trabaja con decimales de punto.
  const normalizedUnitCost = unitCost.trim().replace(',', '.');
  const parsedCost = Number(normalizedUnitCost);
  const canPreviewPrice =
    selectedProduct !== undefined &&
    /^\d+(?:\.\d{1,6})?$/.test(normalizedUnitCost) &&
    Number.isFinite(parsedCost) &&
    parsedCost >= 0;
  const {
    mutate: previewPrice,
    data: pricePreview,
    isPending: isPreviewingPrice,
    isError: isPreviewingPriceError,
  } = useMutation({
    mutationFn: ({ productId: id, cost }: { productId: number; cost: string }) =>
      previewProductPriceForCost(id, cost),
  });

  // Una breve pausa evita disparar una petición por cada dígito, pero la
  // fórmula sigue siendo la del backend y no se persiste absolutamente nada.
  useEffect(() => {
    if (!canPreviewPrice || selectedProductId === undefined) return;
    const timer = window.setTimeout(() => {
      previewPrice({ productId: selectedProductId, cost: normalizedUnitCost });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [canPreviewPrice, normalizedUnitCost, previewPrice, selectedProductId]);

  const submit = handleSubmit((values) => {
    onSubmit(
      {
        product_id: Number(values.product_id),
        package_id: Number(values.package_id),
        quantity_packages: values.quantity_packages,
        unit_cost: values.unit_cost,
        tax_rate: values.tax_rate,
        discount_rate: values.discount_rate,
      },
      {
        product_name: selectedProduct?.name ?? '?',
        unit_name: selectedUnitName ?? '?',
        rounded_price: pricePreview?.rounded_price ?? null,
      },
    );
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
        Unidad
        <input
          type="text"
          readOnly
          value={selectedUnitName ?? ''}
          placeholder="—"
          className="mt-1 block w-24 rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-600"
        />
        <input type="hidden" {...register('package_id')} />
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
        Coste/unidad
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
        PVP previsto
        <input
          type="text"
          readOnly
          value={
            pricePreview
              ? formatMoney(pricePreview.rounded_price)
              : isPreviewingPrice
                ? 'Calculando…'
                : ''
          }
          placeholder="—"
          className="mt-1 block w-28 rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800"
        />
        {isPreviewingPriceError && (
          <p className="mt-1 text-xs text-red-600">No se ha podido calcular el PVP previsto.</p>
        )}
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
        {isPending ? 'Guardando…' : submitLabel}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar edición
        </button>
      )}
    </form>
  );
}
