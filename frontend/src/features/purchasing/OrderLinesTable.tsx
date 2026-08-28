import { useEffect, useState } from 'react';

import { type OrderLineInput, type PurchaseOrderLine } from '@/features/purchasing/api';
import { decimalInputValue } from '@/lib/decimal';
import { formatMoney, formatQuantity } from '@/lib/format';

interface OrderLinesTableProps {
  lines: PurchaseOrderLine[];
  canRemove: boolean;
  canEdit: boolean;
  onRemove: (lineId: number) => void;
  onUpdate: (lineId: number, payload: OrderLineInput) => void;
  isRemoving: boolean;
}

interface EditableValues {
  quantity_packages: string;
  unit_cost: string;
  tax_rate: string;
  discount_rate: string;
}

function valuesFromLine(line: PurchaseOrderLine): EditableValues {
  return {
    quantity_packages: decimalInputValue(line.quantity_packages),
    unit_cost: decimalInputValue(line.unit_cost),
    tax_rate: decimalInputValue(line.tax_rate),
    discount_rate: decimalInputValue(line.discount_rate),
  };
}

function normalizedDecimal(value: string, options: { positive?: boolean } = {}): string | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || (options.positive ? numeric <= 0 : numeric < 0)) return null;
  return normalized;
}

function EditableOrderLineRow({
  line,
  onUpdate,
  onRemove,
  canRemove,
  isRemoving,
}: {
  line: PurchaseOrderLine;
  onUpdate: (lineId: number, payload: OrderLineInput) => void;
  onRemove: (lineId: number) => void;
  canRemove: boolean;
  isRemoving: boolean;
}) {
  const [values, setValues] = useState<EditableValues>(() => valuesFromLine(line));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValues(valuesFromLine(line));
  }, [line]);

  const save = () => {
    const quantity = normalizedDecimal(values.quantity_packages, { positive: true });
    const cost = normalizedDecimal(values.unit_cost);
    const taxRate = normalizedDecimal(values.tax_rate);
    const discountRate = normalizedDecimal(values.discount_rate);
    if (quantity === null || cost === null || taxRate === null || discountRate === null) {
      setError('Revisa cantidad, coste, IVA y descuento.');
      return;
    }
    if (Number(discountRate) > 100) {
      setError('El descuento no puede superar el 100 %.');
      return;
    }
    setError(null);
    const current = valuesFromLine(line);
    if (
      quantity === current.quantity_packages.replace(',', '.') &&
      cost === current.unit_cost.replace(',', '.') &&
      taxRate === current.tax_rate.replace(',', '.') &&
      discountRate === current.discount_rate.replace(',', '.')
    ) {
      return;
    }
    onUpdate(line.id, {
      product_id: line.product_id,
      package_id: line.package_id,
      quantity_packages: quantity,
      unit_cost: cost,
      tax_rate: taxRate,
      discount_rate: discountRate,
    });
  };

  const updateValue = (field: keyof EditableValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="px-2 py-2 font-medium text-slate-800">{line.product_name}</td>
      <td className="px-2 py-2">{line.package_name}</td>
      <td className="px-2 py-2">
        <input
          aria-label={`Cantidad de ${line.product_name}`}
          value={values.quantity_packages}
          inputMode="decimal"
          onChange={(event) => updateValue('quantity_packages', event.target.value)}
          onBlur={save}
          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        {formatQuantity(String(Number(line.quantity_received) / Number(line.package_factor)))}
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`Coste por unidad de ${line.product_name}`}
          value={values.unit_cost}
          inputMode="decimal"
          onChange={(event) => updateValue('unit_cost', event.target.value)}
          onBlur={save}
          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`IVA de ${line.product_name}`}
          value={values.tax_rate}
          inputMode="decimal"
          onChange={(event) => updateValue('tax_rate', event.target.value)}
          onBlur={save}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-2 py-2">
        <input
          aria-label={`Descuento de ${line.product_name}`}
          value={values.discount_rate}
          inputMode="decimal"
          onChange={(event) => updateValue('discount_rate', event.target.value)}
          onBlur={save}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        {error && <p className="mt-1 max-w-36 text-xs text-red-600">{error}</p>}
      </td>
      <td className="px-2 py-2">{formatMoney(line.total)}</td>
      {canRemove && (
        <td className="px-2 py-2 text-right">
          <button
            type="button"
            onClick={() => onRemove(line.id)}
            disabled={isRemoving}
            className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
          >
            Quitar
          </button>
        </td>
      )}
    </tr>
  );
}

export function OrderLinesTable({
  lines,
  canRemove,
  canEdit,
  onRemove,
  onUpdate,
  isRemoving,
}: OrderLinesTableProps) {
  if (lines.length === 0) {
    return <p className="text-sm text-slate-500">Este pedido todavía no tiene líneas.</p>;
  }

  return (
    <div className="mb-3 overflow-x-auto rounded border border-slate-200 bg-white">
      {canEdit && (
        <p className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Edita una celda y pulsa Tab o haz clic fuera: el cambio se guarda automáticamente.
        </p>
      )}
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr>
            <th className="px-2 py-2 font-medium">Producto</th>
            <th className="px-2 py-2 font-medium">Unidad</th>
            <th className="px-2 py-2 font-medium">Pedido</th>
            <th className="px-2 py-2 font-medium">Recibido</th>
            <th className="px-2 py-2 font-medium">Coste/ud.</th>
            <th className="px-2 py-2 font-medium">IVA %</th>
            <th className="px-2 py-2 font-medium">Dto. %</th>
            <th className="px-2 py-2 font-medium">Total</th>
            {canRemove && <th className="px-2 py-2 font-medium" />}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) =>
            canEdit ? (
              <EditableOrderLineRow
                key={line.id}
                line={line}
                onUpdate={onUpdate}
                onRemove={onRemove}
                canRemove={canRemove}
                isRemoving={isRemoving}
              />
            ) : (
              <tr key={line.id} className="border-t border-slate-200">
                <td className="px-2 py-2">{line.product_name}</td>
                <td className="px-2 py-2">{line.package_name}</td>
                <td className="px-2 py-2">{formatQuantity(line.quantity_packages)}</td>
                <td className="px-2 py-2">
                  {formatQuantity(
                    String(Number(line.quantity_received) / Number(line.package_factor)),
                  )}
                </td>
                <td className="px-2 py-2">{formatMoney(line.unit_cost)}</td>
                <td className="px-2 py-2">{line.tax_rate}%</td>
                <td className="px-2 py-2">{line.discount_rate}%</td>
                <td className="px-2 py-2">{formatMoney(line.total)}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
