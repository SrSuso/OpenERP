import { useState, type FormEvent } from 'react';

import { type Product } from '@/features/catalog/api';
import { formatQuantity } from '@/lib/format';

interface PackagesPanelProps {
  product: Product;
  onAddPackage: (name: string, factor: string, barcode: string | null) => void;
  onAddBarcode: (packageId: number, barcode: string) => void;
  onEditBarcode: (packageId: number, barcodeId: number, barcode: string) => void;
  onDeleteBarcode: (packageId: number, barcodeId: number) => void;
  isAddingPackage: boolean;
  isAddingBarcode: boolean;
  isSavingBarcode: boolean;
  barcodeError: string | null;
}

/** Un código de barras editable en el sitio — clic en "Editar" lo convierte
 * en un campo de texto; "Guardar" lo confirma (`onEditBarcode`), "Cancelar"
 * lo descarta sin tocar nada. Separado de una simple lista de texto porque
 * un código tecleado mal o que ha cambiado en la etiqueta del fabricante
 * antes no se podía corregir, sólo añadir uno nuevo al lado. */
function BarcodeRow({
  packageId,
  barcode,
  onEdit,
  onDelete,
  isSaving,
}: {
  packageId: number;
  barcode: { id: number; barcode: string };
  onEdit: (packageId: number, barcodeId: number, barcode: string) => void;
  onDelete: (packageId: number, barcodeId: number) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(barcode.barcode);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200">
        {barcode.barcode}
        <button
          type="button"
          onClick={() => {
            setValue(barcode.barcode);
            setEditing(true);
          }}
          className="text-slate-400 hover:text-brand-700"
          aria-label={`Editar código de barras ${barcode.barcode}`}
        >
          ✎
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`¿Eliminar el código de barras ${barcode.barcode}?`)) {
              onDelete(packageId, barcode.id);
            }
          }}
          className="text-slate-400 hover:text-red-600"
          aria-label={`Eliminar código de barras ${barcode.barcode}`}
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-24 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
        aria-label={`Nuevo valor para el código de barras ${barcode.barcode}`}
      />
      <button
        type="button"
        disabled={isSaving || !value.trim() || value.trim() === barcode.barcode}
        onClick={() => {
          onEdit(packageId, barcode.id, value.trim());
          setEditing(false);
        }}
        className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-40"
      >
        Guardar
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs font-medium text-slate-500 hover:underline"
      >
        Cancelar
      </button>
    </span>
  );
}

/** Presentaciones (cajas) de un producto — regla 4: cada una se convierte a
 * la unidad base mediante `factor`. La presentación base (factor 1) la crea
 * el propio backend al dar de alta el producto; esto sólo añade las demás
 * ("CAJA 6", "PALET 120"...) y sus códigos de barras. */
export function PackagesPanel({
  product,
  onAddPackage,
  onAddBarcode,
  onEditBarcode,
  onDeleteBarcode,
  isAddingPackage,
  isAddingBarcode,
  isSavingBarcode,
  barcodeError,
}: PackagesPanelProps) {
  const [name, setName] = useState('');
  const [factor, setFactor] = useState('');
  const [barcode, setBarcode] = useState('');
  const [barcodeTargets, setBarcodeTargets] = useState<Record<number, string>>({});

  function submitPackage(event: FormEvent) {
    event.preventDefault();
    onAddPackage(name, factor, barcode === '' ? null : barcode);
    setName('');
    setFactor('');
    setBarcode('');
  }

  function submitBarcode(packageId: number) {
    const value = barcodeTargets[packageId];
    if (!value) return;
    onAddBarcode(packageId, value);
    setBarcodeTargets((current) => ({ ...current, [packageId]: '' }));
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
      {barcodeError && <p className="mb-2 text-xs text-red-600">{barcodeError}</p>}
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-400">
          <tr>
            <th className="py-1 font-medium">Formato</th>
            <th className="py-1 font-medium">Factor ({product.base_unit_name})</th>
            <th className="py-1 font-medium">Códigos de barras</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {product.packages.map((pkg) => (
            <tr key={pkg.id} className="border-t border-slate-200">
              <td className="py-1.5 align-top">
                {pkg.name}
                {pkg.is_base && <span className="ml-1 text-xs text-slate-400">(base)</span>}
              </td>
              <td className="py-1.5 align-top">{formatQuantity(pkg.factor)}</td>
              <td className="py-1.5 align-top">
                {pkg.barcodes.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {pkg.barcodes.map((b) => (
                      <BarcodeRow
                        key={b.id}
                        packageId={pkg.id}
                        barcode={b}
                        onEdit={onEditBarcode}
                        onDelete={onDeleteBarcode}
                        isSaving={isSavingBarcode}
                      />
                    ))}
                  </div>
                ) : (
                  '—'
                )}
              </td>
              <td className="py-1.5 align-top">
                <div className="flex gap-1">
                  <input
                    type="text"
                    placeholder="nuevo código"
                    value={barcodeTargets[pkg.id] ?? ''}
                    onChange={(event) =>
                      setBarcodeTargets((current) => ({
                        ...current,
                        [pkg.id]: event.target.value,
                      }))
                    }
                    className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                  />
                  <button
                    type="button"
                    disabled={isAddingBarcode || !barcodeTargets[pkg.id]}
                    onClick={() => submitBarcode(pkg.id)}
                    className="rounded px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                  >
                    Añadir
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form onSubmit={submitPackage} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          Nuevo formato
          <input
            type="text"
            required
            placeholder="CAJA 6"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Factor
          <input
            type="text"
            inputMode="decimal"
            required
            placeholder="6"
            value={factor}
            onChange={(event) => setFactor(event.target.value)}
            className="mt-1 block w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Código de barras (opcional)
          <input
            type="text"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            className="mt-1 block w-32 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={isAddingPackage}
          className="rounded bg-brand-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {isAddingPackage ? 'Añadiendo…' : 'Añadir formato'}
        </button>
      </form>
    </div>
  );
}
