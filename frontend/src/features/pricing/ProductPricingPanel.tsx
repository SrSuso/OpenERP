import { useState } from 'react';

import { type Product, type ProductCategory } from '@/features/catalog/api';
import { type PricingOverrideInput, type Tax } from '@/features/pricing/api';
import { TaxChips } from '@/features/pricing/TaxChips';
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
  const [amountInput, setAmountInput] = useState(product.margin_amount ?? '');
  // `product.taxes` sólo trae algo cuando el producto tiene su propio
  // override (regla del backend: vacío = hereda, nunca "sin impuestos") —
  // si está vacío, se muestran marcados los de la categoría para que la
  // interfaz no dé a entender que no se aplica ningún impuesto. Tocar
  // cualquier chip mientras se hereda "materializa" ese conjunto heredado
  // en un override propio a partir de ahí (isOverride pasa a true).
  const hasOwnTaxes = product.taxes.length > 0;
  const [isOverride, setIsOverride] = useState(hasOwnTaxes);
  const [taxIds, setTaxIds] = useState<Set<number>>(
    new Set((hasOwnTaxes ? product.taxes : (category?.taxes ?? [])).map((t) => t.id)),
  );

  const inheritsMargin = marginInput.trim() === '';
  const inheritsAmount = amountInput.trim() === '';

  function chooseTax(next: Set<number>) {
    setIsOverride(true);
    setTaxIds(next);
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
      margin_amount: inheritsAmount ? null : amountInput,
      // Sin tocar nada: sigue vacío (hereda), aunque la interfaz muestre
      // marcados los de la categoría — nunca se manda ese conjunto como
      // si fuera una elección propia sin que el usuario haya interactuado.
      tax_ids: isOverride ? [...taxIds] : [],
    });
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-4">
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

        <label className="text-xs text-slate-600">
          Margen fijo (€)
          <input
            type="text"
            inputMode="decimal"
            value={amountInput}
            placeholder={`heredado: ${category?.margin_amount ?? '0'} €`}
            onChange={(event) => setAmountInput(event.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-400">
            Dinero por unidad, encima del coste y de los impuestos. Se suma al final: es lo que se
            gana limpio con cada uno. Se puede usar sola o junto al porcentaje.
          </span>
        </label>

        <div className="text-xs text-slate-600">
          <span className="block">PVP actual</span>
          <p className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800">
            {formatMoney(product.list_price)}
          </p>
        </div>

        <div className="text-xs text-slate-600 sm:col-span-4">
          <span className="mb-1 block">
            Impuestos —{' '}
            {isOverride
              ? 'propios de este producto'
              : `heredados de "${category?.name ?? 'sin categoría'}" (marcados igualmente, para que se vea que sí se aplican)`}
          </span>
          <TaxChips taxes={taxes} selected={taxIds} onChange={chooseTax} />
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
