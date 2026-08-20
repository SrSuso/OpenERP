import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { type Product, type ProductCategory } from '@/features/catalog/api';
import {
  productPriceHistoryQuery,
  productPriceCalculationQuery,
  setManualPrice,
  type PricingOverrideInput,
  type Tax,
} from '@/features/pricing/api';
import { TaxChips } from '@/features/pricing/TaxChips';
import { decimalString } from '@/lib/decimal';
import { formatMoney } from '@/lib/format';
import { useUnsavedWarning } from '@/lib/unsaved';

/** Si lo tecleado es *otra cantidad* que lo guardado. Vacío significa
 * «hereda», y eso no es un número: sólo coincide con un guardado que
 * también estuviera vacío. */
function differs(typed: string, saved: string | null): boolean {
  const isEmpty = typed.trim() === '';
  if (isEmpty || saved === null) return isEmpty !== (saved === null);
  const typedNumber = Number(typed.replace(',', '.'));
  return Number.isNaN(typedNumber) || typedNumber !== Number(saved);
}

/** El resultado previo al redondeo puede tener fracciones de céntimo. Se
 * muestran hasta seis decimales, igual que los importes que guarda la base
 * de datos, para que el recuadro de cálculo no esconda la diferencia. */
function formatCalculatedMoney(value: string): string {
  return `${new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(value))} €`;
}

interface ProductPricingPanelProps {
  product: Product;
  category: ProductCategory | undefined;
  taxes: Tax[];
  onSave: (input: PricingOverrideInput & { cost?: string }) => void;
  isSaving: boolean;
  /** Para que la ficha pueda preguntar antes de cambiar de pestaña con
   * algo tecleado sin guardar. */
  onDirtyChange?: (isDirty: boolean) => void;
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
  onDirtyChange,
}: ProductPricingPanelProps) {
  const queryClient = useQueryClient();
  const calculation = useQuery(productPriceCalculationQuery(product.id));
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
  const [manualPriceInput, setManualPriceInput] = useState('');
  const [manualPriceError, setManualPriceError] = useState<string | null>(null);

  const manualPriceMutation = useMutation({
    mutationFn: (price: string) => setManualPrice(product.id, price),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'product', product.id] });
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
      void queryClient.invalidateQueries({
        queryKey: productPriceCalculationQuery(product.id).queryKey,
      });
      void queryClient.invalidateQueries({
        queryKey: productPriceHistoryQuery(product.id).queryKey,
      });
      setManualPriceInput('');
      setManualPriceError(null);
    },
    onError: () => setManualPriceError('No se ha podido fijar el precio.'),
  });

  const inheritsMargin = marginInput.trim() === '';
  const inheritsAmount = amountInput.trim() === '';
  const savedTaxIds = new Set(product.taxes.map((tax) => tax.id));
  const taxesChanged =
    isOverride &&
    (taxIds.size !== savedTaxIds.size || [...taxIds].some((taxId) => !savedTaxIds.has(taxId)));

  // Lo tecleado difiere de lo guardado: si se sale ahora, se pierde.
  //
  // Se comparan cantidades, no cadenas: lo guardado viene como "0.300000"
  // y quien lo repasa escribe "0,30", que es lo mismo. Comparando el texto,
  // salir preguntaba «vas a perder los cambios» sin haber cambiado nada.
  const isDirty =
    differs(cost, product.cost) ||
    differs(marginInput, product.margin_rate) ||
    differs(amountInput, product.margin_amount) ||
    isOverride !== hasOwnTaxes ||
    taxesChanged;
  useUnsavedWarning(isDirty);
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

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

  function submitManualPrice() {
    const parsed = decimalString({ min: 0 }).safeParse(manualPriceInput);
    if (!parsed.success) {
      setManualPriceError(parsed.error.issues[0]?.message ?? 'Precio no válido.');
      return;
    }
    setManualPriceError(null);
    manualPriceMutation.mutate(parsed.data);
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
          <span className="block">PVP calculado (sin redondear)</span>
          <p className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800">
            {calculation.data ? formatCalculatedMoney(calculation.data.calculated_price) : '—'}
          </p>
          <span className="mt-1 block text-xs text-slate-400">Antes del redondeo comercial.</span>
        </div>

        <div className="text-xs text-slate-600">
          <span className="block">PVP de venta (redondeado)</span>
          <p className="mt-1 rounded border border-brand-200 bg-brand-50 px-2 py-1 text-sm font-medium text-slate-800">
            {formatMoney(product.list_price)}
          </p>
          <span className="mt-1 block text-xs text-slate-400">
            {calculation.data && calculation.data.rounded_price !== product.list_price
              ? 'Precio manual: se respeta tal cual.'
              : 'Redondeado al alza a cinco céntimos.'}
          </span>

          <div className="mt-3 border-t border-slate-200 pt-3">
            <p className="mb-1 text-xs font-medium text-slate-600">Precio manual</p>
            <p className="mb-2 text-xs text-slate-500">
              Fija un PVP exacto, saltándose cualquier fórmula. Quita la fórmula propia si la había.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={manualPriceInput}
                onChange={(event) => setManualPriceInput(event.target.value)}
                placeholder={product.list_price}
                className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={submitManualPrice}
                disabled={manualPriceMutation.isPending || !manualPriceInput.trim()}
                className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {manualPriceMutation.isPending ? 'Guardando…' : 'Fijar precio manual'}
              </button>
            </div>
            {manualPriceError && <p className="mt-1 text-xs text-red-600">{manualPriceError}</p>}
          </div>
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
