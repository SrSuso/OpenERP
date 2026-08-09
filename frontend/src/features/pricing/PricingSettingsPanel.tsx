import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  pricingSettingsQuery,
  previewFormula,
  updatePricingSettings,
} from '@/features/pricing/api';
import { FormulaHelp } from '@/features/pricing/FormulaHelp';
import { formatMoney } from '@/lib/format';

/** La fórmula que calcula el PVP de cualquier producto que no tenga una
 * propia — "quiero definir yo la fórmula", tal como se pidió. Usa las
 * mismas cuatro variables que ya validaba el motor de fórmulas por
 * producto (fase 4): cost, tax_rate, surcharge_rate, margin_rate — aquí
 * tax_rate/margin_rate son los *efectivos* (el propio valor del producto,
 * o si no tiene, el de su categoría). */
export function PricingSettingsPanel({ canManage }: { canManage: boolean }) {
  const settings = useQuery(pricingSettingsQuery);
  const queryClient = useQueryClient();
  const [formulaInput, setFormulaInput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const formula = formulaInput ?? settings.data?.formula ?? '';

  const previewMutation = useMutation({
    mutationFn: () =>
      previewFormula({
        formula,
        cost: '10',
        tax_rate: '21',
        surcharge_rate: '0',
        margin_rate: '20',
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => updatePricingSettings(formula),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pricingSettingsQuery.queryKey });
      setFormulaInput(null);
      setError(null);
      setSaved(true);
    },
    onError: () => {
      setSaved(false);
      setError('Fórmula no válida — revisa la sintaxis (sólo +, -, *, /, round/ceil/floor).');
    },
  });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Fórmula del PVP</h3>

      <div className="mb-4">
        <FormulaHelp />
      </div>

      {settings.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {settings.data && (
        <>
          <textarea
            value={formula}
            onChange={(event) => {
              setFormulaInput(event.target.value);
              setSaved(false);
            }}
            disabled={!canManage}
            rows={2}
            className="w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm disabled:bg-slate-50"
          />

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending}
              className="rounded px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
            >
              Probar con coste 10€, IVA 21%, margen 20%
            </button>
            {previewMutation.data && (
              <span className="text-sm text-slate-700">
                → PVP: {formatMoney(previewMutation.data)}
              </span>
            )}
            {previewMutation.isError && (
              <span className="text-sm text-red-600">Fórmula no válida.</span>
            )}
          </div>

          {canManage && (
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || formula === settings.data.formula}
              className="mt-3 rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Guardando…' : 'Guardar fórmula'}
            </button>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {saved && (
            <p className="mt-2 text-sm text-green-700">
              Guardada — todos los productos sin fórmula propia se han recalculado.
            </p>
          )}
        </>
      )}
    </div>
  );
}
