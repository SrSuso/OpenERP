import { type Lot } from '@/features/lots/api';

/** Lotes de un producto, en el mismo orden FEFO (caducidad más próxima
 * primero, sin fecha al final) en que el backend los consumiría — ver
 * backend/app/lots/service.py's `plan_fefo`. */
export function LotsTable({ lots }: { lots: Lot[] }) {
  if (lots.length === 0) {
    return <p className="text-sm text-slate-500">Este producto todavía no tiene lotes.</p>;
  }

  const sorted = [...lots].sort((a, b) => {
    if (a.expiration_date === null) return 1;
    if (b.expiration_date === null) return -1;
    return a.expiration_date.localeCompare(b.expiration_date);
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Lote</th>
            <th className="px-4 py-2 font-medium">Fabricación</th>
            <th className="px-4 py-2 font-medium">Caducidad</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((lot) => (
            <tr key={lot.id} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-2 font-medium text-slate-800">{lot.lot_number}</td>
              <td className="px-4 py-2">{lot.manufacturing_date ?? '—'}</td>
              <td className="px-4 py-2">{lot.expiration_date ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
