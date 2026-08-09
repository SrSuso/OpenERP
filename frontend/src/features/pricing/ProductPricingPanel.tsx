import { useState } from 'react';

import { type Product, type ProductCategory } from '@/features/catalog/api';
import { type PricingOverrideInput, type Tax } from '@/features/pricing/api';
import { decimalString } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';

interface ProductPricingPanelProps {
  product: Product;
  category: ProductCategory | undefined;
  taxes: Tax[];
  onSave: (input: PricingOverrideInput & { cost?: string }) => void;
  isSaving: boolean;
}

/** Coste, margen e impuestos de un producto — el margen/impuestos vacíos
 * heredan los de su categoría (regla pedida por el usuario: la categoría
 * es el valor por defecto, el producto lo pisa sólo si fija el suyo). El
 * PVP en sí (`product.list_price`) no se edita aquí directamente: lo
 * recalcula el backend con la fórmula de la tienda en cuanto se guarda
 * algo — ver docs/ARCHITECTURE.md, módulo Precios. */
export function ProductPricingPanel({
  product,
  category,
  taxes,
  onSave,
  isSaving,
}: ProductPricingPanelProps) {
  const [cost, setCost] = useState(product.cost);
  const [costError, setCostError] = useState<string | null>(null);
  const [marginInput, setMarginInput] = useState(product.margin_rate ?? '');
  const [taxIds, setTaxIds] = useState<Set<number>>(new Set(product.taxes.map((t) => t.id)));

  const inheritsMargin = marginInput.trim() === '';
  const inheritsTaxes = taxIds.size === 0;

  function toggleTax(id: number) {
    setTaxIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    const parsedCost = decimalString({ min: 0 }).safeParse(cost);
    if (!parsedCost.success) {
      setCostError(parsedCost.error.issues[0]?.message ?? 'Coste no válido.');
      return;
    }
    setCostError(null);
    onSave({
      cost: parsedCost.data,
      margin_rate: inheritsMargin ? null : marginInput,
      tax_ids: [...taxIds],
    });
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-600">
          Coste
          <input
            type="text"
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          {costError && <p className="mt-1 text-xs text-red-600">{costError}</p>}
        </label>

        <label className="text-xs text-slate-600">
          Margen (%)
          <input
            type="text"
            inputMode="decimal"
            value={marginInput}
            placeholder={`heredado: ${category?.margin_rate ?? '0'}%`}
            onChange={(event) => setMarginInput(event.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-400">
            {inheritsMargin
              ? `Hereda de "${category?.name ?? 'sin categoría'}".`
              : 'Valor propio de este producto.'}
          </span>
        </label>

        <div className="text-xs text-slate-600">
          <span className="block">PVP actual</span>
          <p className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800">
            {formatMoney(product.list_price)}
          </p>
        </div>

        <div className="text-xs text-slate-600 sm:col-span-3">
          <span className="mb-1 block">
            Impuestos —{' '}
            {inheritsTaxes
              ? `hereda los de "${category?.name ?? 'sin categoría'}"`
              : 'propios de este producto'}
          </span>
          <div className="flex flex-wrap gap-3">
            {taxes.map((tax) => (
              <label key={tax.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={taxIds.has(tax.id)}
                  onChange={() => toggleTax(tax.id)}
                />
                {tax.name} ({tax.rate}%)
              </label>
            ))}
            {taxes.length === 0 && (
              <span className="text-slate-400">No hay impuestos creados.</span>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={isSaving}
        className="mt-3 rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {isSaving ? 'Guardando…' : 'Guardar precio'}
      </button>
    </div>
  );
}
