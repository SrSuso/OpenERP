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
 * o si no tiene, el de su categoría). También vive aquí "los precios ya
 * incluyen el IVA" — es del mismo tipo de decisión (cómo se calcula el
 * dinero en toda la tienda, no algo por producto o por plantilla de
 * ticket), aunque no cambia la fórmula en sí (ver
 * backend/app/pricing/models.py's PricingSettings.prices_include_tax). */
export function PricingSettingsPanel({ canManage }: { canManage: boolean }) {
  const settings = useQuery(pricingSettingsQuery);
  const queryClient = useQueryClient();
  const [formulaInput, setFormulaInput] = useState<string | null>(null);
  const [pricesIncludeTaxInput, setPricesIncludeTaxInput] = useState<boolean | null>(null);
  // La prueba de fórmula es deliberadamente editable: 5,2 % es el
  // recargo habitual para IVA 21 %, pero una tienda puede trabajar sin
  // recargo o con el tipo correspondiente a otro IVA.
  const [previewSurchargeRate, setPreviewSurchargeRate] = useState('5.2');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const formula = formulaInput ?? settings.data?.formula ?? '';
  const pricesIncludeTax = pricesIncludeTaxInput ?? settings.data?.prices_include_tax ?? false;

  const previewMutation = useMutation({
    mutationFn: () =>
      previewFormula({
        formula,
        cost: '10',
        tax_rate: '21',
        surcharge_rate: previewSurchargeRate.replace(',', '.'),
        margin_rate: '20',
        margin_amount: '0',
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () => updatePricingSettings(formula, pricesIncludeTax),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pricingSettingsQuery.queryKey });
      // Guardar recalcula el PVP de todo producto sin fórmula propia
      // (backend: app.pricing.service.update_settings) — refresca la
      // lista de productos para que se vea al momento, no sólo tras
      // recargar la página.
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
      setFormulaInput(null);
      setPricesIncludeTaxInput(null);
      setError(null);
      setSaved(true);
    },
    onError: () => {
      setSaved(false);
      setError('Fórmula no válida — revisa la sintaxis (sólo +, -, *, /, round/ceil/floor).');
    },
  });

  const unchanged =
    settings.data !== undefined &&
    formula === settings.data.formula &&
    pricesIncludeTax === settings.data.prices_include_tax;

  // Una fórmula que usa `tax_rate` produce un PVP con el impuesto dentro;
  // si además la caja lo suma, se cobra dos veces. Es la combinación que
  // se coló en su día y por la que existe la migración
  // 5b4760e2a878 — aquí se avisa para que no vuelva a pasar en silencio.
  const contradictsFormula = formula.includes('tax_rate') && !pricesIncludeTax;

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

          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Recargo eq. (%)
              <input
                aria-label="Recargo de equivalencia para la prueba"
                type="text"
                inputMode="decimal"
                value={previewSurchargeRate}
                onChange={(event) => setPreviewSurchargeRate(event.target.value)}
                disabled={!canManage}
                className="w-28 rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-50"
              />
            </label>
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
          <p className="mt-1 text-xs text-slate-500">
            La prueba usa el recargo indicado arriba; para IVA 21 %, el habitual es 5,2 %.
          </p>

          <label className="mt-3 flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={pricesIncludeTax}
              disabled={!canManage}
              onChange={(event) => {
                setPricesIncludeTaxInput(event.target.checked);
                setSaved(false);
              }}
              className="mt-0.5"
            />
            <span>
              El PVP ya incluye el IVA
              <span className="mt-0.5 block text-xs text-slate-400">
                Actívalo si estás en <strong>recargo de equivalencia</strong>: el IVA y el recargo
                se los pagas al proveedor, van dentro del coste (y por tanto del PVP), y en caja no
                se vuelve a sumar nada — se cobra el precio de la etiqueta tal cual. El ticket
                seguirá pudiendo desglosar cuánto IVA lleva dentro (se configura en la plantilla de
                ticket).
                <br />
                Déjalo desactivado en régimen general, donde el PVP es sin IVA y la caja lo suma
                encima.
              </span>
            </span>
          </label>

          {contradictsFormula && (
            <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <strong>Revisa esto:</strong> tu fórmula usa <code>tax_rate</code>, así que el PVP que
              calcula <em>ya lleva el IVA dentro</em> — pero con esta casilla desactivada la caja se
              lo vuelve a sumar, y cobrarías de más. Actívala, o quita <code>tax_rate</code> de la
              fórmula si tu PVP es sin impuestos.
            </p>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || unchanged}
              className="mt-3 rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Guardando…' : 'Guardar'}
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
