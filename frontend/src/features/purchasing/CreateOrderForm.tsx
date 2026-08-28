import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Product } from '@/features/catalog/api';
import { AddOrderLineForm } from '@/features/purchasing/AddOrderLineForm';
import { type OrderLineInput } from '@/features/purchasing/api';
import { previewProductPriceForCost } from '@/features/pricing/api';
import { type Supplier } from '@/features/suppliers/api';
import { formatMoney } from '@/lib/format';

const createOrderSchema = z.object({
  supplier_id: z.string().min(1, 'Elige un proveedor.'),
  notes: z.string().max(2000).optional(),
});

type CreateOrderFormValues = z.infer<typeof createOrderSchema>;

interface StagedLine extends OrderLineInput {
  label: string;
  preview_price: string | null;
}

interface CreateOrderFormProps {
  suppliers: Supplier[];
  products: Product[];
  onSubmit: (payload: { supplier_id: number; notes: string; lines: OrderLineInput[] }) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
}

function decimalForInput(value: string): string {
  return value.replace('.', ',');
}

function normalizedDecimal(value: string, options: { positive?: boolean } = {}): string | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || (options.positive ? numeric <= 0 : numeric < 0)) return null;
  return normalized;
}

function StagedOrderLineRow({
  line,
  index,
  onUpdate,
  onRemove,
}: {
  line: StagedLine;
  index: number;
  onUpdate: (
    index: number,
    field: 'quantity_packages' | 'unit_cost' | 'tax_rate' | 'discount_rate',
    value: string,
  ) => void;
  onRemove: (index: number) => void;
}) {
  const unitCost = normalizedDecimal(line.unit_cost);
  const [previewPrice, setPreviewPrice] = useState(line.preview_price);
  const {
    mutate: previewPriceForCost,
    isPending: isPreviewPending,
    isError: isPreviewError,
  } = useMutation({
    mutationFn: ({ productId, cost }: { productId: number; cost: string }) =>
      previewProductPriceForCost(productId, cost),
  });

  useEffect(() => {
    setPreviewPrice(line.preview_price);
  }, [line.preview_price]);

  useEffect(() => {
    if (unitCost === null) {
      setPreviewPrice(null);
      return;
    }
    const timer = window.setTimeout(() => {
      previewPriceForCost(
        { productId: line.product_id, cost: unitCost },
        { onSuccess: (preview) => setPreviewPrice(preview.rounded_price) },
      );
    }, 200);
    return () => window.clearTimeout(timer);
  }, [line.product_id, previewPriceForCost, unitCost]);

  return (
    <tr className="border-t border-slate-100">
      <td className="px-2 py-2 font-medium text-slate-800">{line.label}</td>
      <td className="px-2 py-2">
        <input
          aria-label={`Cantidad de ${line.label}`}
          value={decimalForInput(line.quantity_packages)}
          inputMode="decimal"
          onChange={(event) =>
            onUpdate(index, 'quantity_packages', event.target.value.replace(',', '.'))
          }
          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`Coste por unidad de ${line.label}`}
          value={decimalForInput(line.unit_cost)}
          inputMode="decimal"
          onChange={(event) => onUpdate(index, 'unit_cost', event.target.value.replace(',', '.'))}
          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`IVA de ${line.label}`}
          value={decimalForInput(line.tax_rate)}
          inputMode="decimal"
          onChange={(event) => onUpdate(index, 'tax_rate', event.target.value.replace(',', '.'))}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`Descuento de ${line.label}`}
          value={decimalForInput(line.discount_rate)}
          inputMode="decimal"
          onChange={(event) =>
            onUpdate(index, 'discount_rate', event.target.value.replace(',', '.'))
          }
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2 font-medium text-emerald-800">
        {previewPrice === null
          ? isPreviewPending
            ? 'Calculando…'
            : '—'
          : formatMoney(previewPrice)}
        {isPreviewError && <p className="mt-1 text-xs font-normal text-red-600">No disponible</p>}
      </td>
      <td className="px-2 py-2 text-right">
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="text-xs font-medium text-red-600 hover:underline"
        >
          Quitar
        </button>
      </td>
    </tr>
  );
}

/** Un pedido se crea ya con sus productos — se apilan localmente (mismo
 * patrón que una recepción de mercancía o una devolución) antes de mandar
 * el pedido y sus líneas juntos; no queda ningún borrador vacío esperando
 * a que alguien vuelva más tarde a añadirle algo. */
export function CreateOrderForm({
  suppliers,
  products,
  onSubmit,
  onCancel,
  isPending,
  submitError,
}: CreateOrderFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateOrderFormValues>({ resolver: zodResolver(createOrderSchema) });

  const [stagedLines, setStagedLines] = useState<StagedLine[]>([]);
  const [stagedError, setStagedError] = useState<string | null>(null);

  const updateStagedLine = (
    index: number,
    field: 'quantity_packages' | 'unit_cost' | 'tax_rate' | 'discount_rate',
    value: string,
  ) => {
    setStagedError(null);
    setStagedLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index
          ? {
              ...line,
              [field]: value,
              // El PVP se calculó con el coste anterior: no enseñamos una
              // estimación caducada si se corrige esta celda en la tabla.
              ...(field === 'unit_cost' ? { preview_price: null } : {}),
            }
          : line,
      ),
    );
  };

  const submit = handleSubmit((values) => {
    if (stagedLines.length === 0) return;

    const lines: OrderLineInput[] = [];
    for (const line of stagedLines) {
      const quantity = normalizedDecimal(line.quantity_packages, { positive: true });
      const cost = normalizedDecimal(line.unit_cost);
      const taxRate = normalizedDecimal(line.tax_rate);
      const discountRate = normalizedDecimal(line.discount_rate);
      if (quantity === null || cost === null || taxRate === null || discountRate === null) {
        setStagedError(`Revisa cantidad, coste, IVA y descuento de ${line.label}.`);
        return;
      }
      if (Number(discountRate) > 100) {
        setStagedError(`El descuento de ${line.label} no puede superar el 100 %.`);
        return;
      }
      lines.push({
        product_id: line.product_id,
        package_id: line.package_id,
        quantity_packages: quantity,
        unit_cost: cost,
        tax_rate: taxRate,
        discount_rate: discountRate,
      });
    }

    setStagedError(null);
    onSubmit({
      supplier_id: Number(values.supplier_id),
      notes: values.notes ?? '',
      lines,
    });
  });

  return (
    // Un <div>, no un <form> — ya contiene el propio <form> de
    // AddOrderLineForm más abajo, y el HTML no admite un <form> anidado
    // dentro de otro (el navegador ignoraría el interior, rompiendo su
    // envío). "Crear pedido" dispara la validación de react-hook-form
    // directamente desde su onClick en vez de un onSubmit de formulario.
    <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Nuevo pedido de compra</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-600">
          Proveedor
          <select
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('supplier_id')}
          >
            <option value="">Elige un proveedor…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          {errors.supplier_id && (
            <p className="mt-1 text-sm text-red-600">{errors.supplier_id.message}</p>
          )}
        </label>

        <label className="text-sm text-slate-600 sm:col-span-2">
          Notas (opcional)
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            {...register('notes')}
          />
        </label>
      </div>

      <h4 className="mt-4 mb-1 text-xs font-semibold uppercase text-slate-500">Productos</h4>

      {stagedLines.length > 0 && (
        <div className="mb-3 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">Producto</th>
                <th className="px-2 py-2 font-medium">Cantidad</th>
                <th className="px-2 py-2 font-medium">Coste/ud.</th>
                <th className="px-2 py-2 font-medium">IVA %</th>
                <th className="px-2 py-2 font-medium">Dto. %</th>
                <th className="px-2 py-2 font-medium">PVP previsto</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {stagedLines.map((line, index) => (
                <StagedOrderLineRow
                  key={`${line.product_id}-${index}`}
                  line={line}
                  index={index}
                  onUpdate={updateStagedLine}
                  onRemove={(lineIndex) =>
                    setStagedLines((current) =>
                      current.filter((_, currentIndex) => currentIndex !== lineIndex),
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {stagedLines.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">
          Añade al menos un producto — un pedido no se puede crear vacío.
        </p>
      )}
      {stagedError && <p className="mb-3 text-sm text-red-600">{stagedError}</p>}

      <AddOrderLineForm
        products={products}
        isPending={false}
        onSubmit={(line, preview) => {
          setStagedError(null);
          setStagedLines((current) => [
            ...current,
            {
              ...line,
              label: `${preview.product_name} — ${preview.unit_name}`,
              preview_price: preview.rounded_price,
            },
          ]);
        }}
        submitLabel="Añadir fila"
      />

      {submitError && <p className="mt-3 text-sm text-red-600">{submitError}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={isPending || stagedLines.length === 0}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Creando…' : 'Crear pedido'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
