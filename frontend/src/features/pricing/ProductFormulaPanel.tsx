import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { type Product, type ProductCategory } from '@/features/catalog/api';
import {
  clearProductFormula,
  previewFormula,
  productPriceCalculationQuery,
  productPriceHistoryQuery,
  setProductFormula,
  type Tax,
} from '@/features/pricing/api';
import { FormulaHelp } from '@/features/pricing/FormulaHelp';
import { ProductPriceHistoryTable } from '@/features/pricing/ProductPriceHistoryTable';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/format';

interface ProductFormulaPanelProps {
  product: Product;
  category: ProductCategory | undefined;
  taxes: Tax[];
  canManage: boolean;
}

/** Igual que `effective_tax_rate`/`effective_margin_rate` en
 * backend/app/pricing/service.py — sólo para la vista previa "pruébala",
 * el cálculo real siempre lo hace el backend al guardar. */
function effectiveTaxRate(product: Product, taxes: Tax[]): string {
  const ownIds = new Set(product.taxes.map((t) => t.id));
  const active = taxes.filter((t) => ownIds.has(t.id) && t.is_active);
  if (product.taxes.length > 0) return String(active.reduce((sum, t) => sum + Number(t.rate), 0));
  return product.tax_rate;
}

/** Una fórmula propia de este producto (pisa la de la tienda mientras esté
 * puesta) o un precio manual fijo (la salta del todo) — más el histórico de
 * cada vez que `list_price` se recalculó. Complementa a
 * `ProductPricingPanel`, que sólo cubre coste/margen/impuestos. */
export function ProductFormulaPanel({
  product,
  category,
  taxes,
  canManage,
}: ProductFormulaPanelProps) {
  const queryClient = useQueryClient();

  const [formulaInput, setFormulaInput] = useState(product.price_formula ?? '');
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const history = useQuery({ ...productPriceHistoryQuery(product.id), enabled: showHistory });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'product', product.id] });
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
    void queryClient.invalidateQueries({
      queryKey: productPriceCalculationQuery(product.id).queryKey,
    });
    void queryClient.invalidateQueries({ queryKey: productPriceHistoryQuery(product.id).queryKey });
  };

  const previewMutation = useMutation({
    mutationFn: () =>
      previewFormula({
        formula: formulaInput,
        cost: product.cost,
        tax_rate: effectiveTaxRate(product, taxes),
        surcharge_rate: product.surcharge_rate,
        margin_rate: product.margin_rate ?? category?.margin_rate ?? '0',
        margin_amount: product.margin_amount ?? category?.margin_amount ?? '0',
      }),
  });

  const saveFormulaMutation = useMutation({
    mutationFn: () => setProductFormula(product.id, formulaInput),
    onSuccess: () => {
      invalidate();
      setFormulaError(null);
    },
    onError: (err: unknown) =>
      setFormulaError(
        err instanceof ApiError
          ? err.message
          : 'Fórmula no válida — revisa la sintaxis (sólo +, -, *, /, round/ceil/floor).',
      ),
  });

  const clearFormulaMutation = useMutation({
    mutationFn: () => clearProductFormula(product.id),
    onSuccess: () => {
      invalidate();
      setFormulaInput('');
      setFormulaError(null);
    },
  });

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Fórmula propia</h4>
      <p className="mb-3 text-xs text-slate-500">
        {product.price_formula
          ? 'Este producto tiene su propia fórmula — pisa a la de la tienda.'
          : 'Sin fórmula propia: usa la fórmula general de la tienda.'}
      </p>

      <div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600">Fórmula propia</p>
          <FormulaHelp />
          <textarea
            value={formulaInput}
            onChange={(event) => {
              setFormulaInput(event.target.value);
              setFormulaError(null);
            }}
            disabled={!canManage}
            rows={2}
            placeholder="p.ej. cost * (1 + margin_rate / 100) * (1 + tax_rate / 100)"
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs disabled:bg-slate-50"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending || !formulaInput.trim()}
              className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              Probar
            </button>
            {previewMutation.data && (
              <span className="text-xs text-slate-700">
                → PVP: {formatMoney(previewMutation.data)}
              </span>
            )}
            {previewMutation.isError && (
              <span className="text-xs text-red-600">Fórmula no válida.</span>
            )}
          </div>
          {canManage && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => saveFormulaMutation.mutate()}
                disabled={saveFormulaMutation.isPending || !formulaInput.trim()}
                className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {saveFormulaMutation.isPending ? 'Guardando…' : 'Guardar fórmula'}
              </button>
              {product.price_formula && (
                <button
                  type="button"
                  onClick={() => clearFormulaMutation.mutate()}
                  disabled={clearFormulaMutation.isPending}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  Quitar fórmula propia
                </button>
              )}
            </div>
          )}
          {formulaError && <p className="mt-1 text-xs text-red-600">{formulaError}</p>}
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowHistory((current) => !current)}
          className="text-xs font-medium text-slate-600 hover:underline"
        >
          {showHistory ? 'Ocultar histórico de precios' : 'Ver histórico de precios'}
        </button>
        {showHistory && (
          <div className="mt-2">
            {history.isPending && <p className="text-xs text-slate-500">Cargando…</p>}
            {history.data && <ProductPriceHistoryTable entries={history.data} />}
          </div>
        )}
      </div>
    </div>
  );
}
