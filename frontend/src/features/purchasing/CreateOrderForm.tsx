import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { type Product } from '@/features/catalog/api';
import { AddOrderLineForm } from '@/features/purchasing/AddOrderLineForm';
import { type OrderLineInput } from '@/features/purchasing/api';
import { type Supplier } from '@/features/suppliers/api';
import { formatQuantity } from '@/lib/format';

const createOrderSchema = z.object({
  supplier_id: z.string().min(1, 'Elige un proveedor.'),
  notes: z.string().max(2000).optional(),
});

type CreateOrderFormValues = z.infer<typeof createOrderSchema>;

interface StagedLine extends OrderLineInput {
  label: string;
}

interface CreateOrderFormProps {
  suppliers: Supplier[];
  products: Product[];
  onSubmit: (payload: { supplier_id: number; notes: string; lines: OrderLineInput[] }) => void;
  onCancel: () => void;
  isPending: boolean;
  submitError: string | null;
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

  const submit = handleSubmit((values) => {
    if (stagedLines.length === 0) return;
    onSubmit({
      supplier_id: Number(values.supplier_id),
      notes: values.notes ?? '',
      lines: stagedLines.map(({ label: _label, ...line }) => line),
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
        <ul className="mb-3 space-y-1 text-sm">
          {stagedLines.map((line, index) => (
            <li key={`${line.product_id}-${index}`} className="flex items-center gap-2">
              <span>
                {line.label} — {formatQuantity(line.quantity_packages)}
              </span>
              <button
                type="button"
                onClick={() => setStagedLines((current) => current.filter((_, i) => i !== index))}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {stagedLines.length === 0 && (
        <p className="mb-3 text-sm text-slate-500">
          Añade al menos un producto — un pedido no se puede crear vacío.
        </p>
      )}

      <AddOrderLineForm
        products={products}
        isPending={false}
        onSubmit={(line) => {
          const product = products.find((p) => p.id === line.product_id);
          const pkg = product?.packages.find((p) => p.id === line.package_id);
          setStagedLines((current) => [
            ...current,
            { ...line, label: `${product?.sku ?? '?'} — ${pkg?.name ?? '?'}` },
          ]);
        }}
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
