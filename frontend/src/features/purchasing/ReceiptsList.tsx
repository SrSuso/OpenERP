import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { applyReceivedCosts, goodsReceiptsQuery } from '@/features/purchasing/api';
import { useBusinessTimezone } from '@/features/settings/useShopSettings';
import { ApiError } from '@/lib/api';
import { formatBusinessDateTime } from '@/lib/businessTime';
import { formatMoney, formatQuantity } from '@/lib/format';

interface ReceiptsListProps {
  orderId: number;
  canManagePricing: boolean;
}

export function ReceiptsList({ orderId, canManagePricing }: ReceiptsListProps) {
  const businessTimezone = useBusinessTimezone();
  const receipts = useQuery(goodsReceiptsQuery(orderId));
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    const available = new Set(
      receipts.data?.flatMap((receipt) =>
        receipt.cost_proposals.map((proposal) => proposal.receipt_line_id),
      ) ?? [],
    );
    setSelected((current) => new Set([...current].filter((id) => available.has(id))));
  }, [receipts.data]);

  const applyMutation = useMutation({
    mutationFn: ({
      receiptId,
      lines,
    }: {
      receiptId: number;
      lines: { receipt_line_id: number; expected_current_cost: string }[];
    }) => applyReceivedCosts(receiptId, lines),
    onSuccess: () => {
      setSelected(new Set());
      setApplyError(null);
      void queryClient.invalidateQueries({ queryKey: ['purchasing', 'receipts', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: unknown) =>
      setApplyError(
        error instanceof ApiError && error.status === 409
          ? 'La propuesta ya no es actual. Se han refrescado los costes recibidos.'
          : 'No se ha podido actualizar el coste de catálogo.',
      ),
  });

  if (receipts.isPending) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (receipts.isError) {
    return <p className="text-sm text-red-600">No se han podido cargar las recepciones.</p>;
  }
  if (receipts.data.length === 0) {
    return <p className="text-sm text-slate-500">Todavía no se ha recibido nada de este pedido.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {receipts.data.map((receipt) => (
        <li key={receipt.id} className="rounded border border-slate-200 bg-white p-2">
          <p className="text-xs text-slate-500">
            {formatBusinessDateTime(receipt.received_at, businessTimezone)}
            {receipt.notes && ` · ${receipt.notes}`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {receipt.lines.map((line) => (
              <li key={line.id}>
                {line.product_name} · {formatQuantity(line.quantity_packages)}
                {line.lot_number && ` · lote ${line.lot_number}`}
              </li>
            ))}
          </ul>
          {receipt.cost_proposals.length > 0 && (
            <section className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
              <p className="text-xs font-semibold text-amber-900">Costes de compra diferentes</p>
              <p className="mt-0.5 text-xs text-amber-800">
                Actualizar el coste puede recalcular el PVP si el producto tiene una fórmula.
              </p>
              <ul className="mt-2 space-y-1">
                {receipt.cost_proposals.map((proposal) => {
                  const checked = selected.has(proposal.receipt_line_id);
                  return (
                    <li key={proposal.receipt_line_id} className="flex items-start gap-2 text-xs">
                      {canManagePricing && (
                        <input
                          aria-label={`Actualizar coste de ${proposal.product_name}`}
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.delete(proposal.receipt_line_id);
                              else next.add(proposal.receipt_line_id);
                              return next;
                            })
                          }
                        />
                      )}
                      <span>
                        {proposal.product_name}: {formatMoney(proposal.current_catalog_cost)} →{' '}
                        {formatMoney(proposal.received_unit_cost)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {canManagePricing && (
                <button
                  type="button"
                  disabled={selected.size === 0 || applyMutation.isPending}
                  onClick={() => {
                    const proposals = receipt.cost_proposals.filter((proposal) =>
                      selected.has(proposal.receipt_line_id),
                    );
                    applyMutation.mutate({
                      receiptId: receipt.id,
                      lines: proposals.map((proposal) => ({
                        receipt_line_id: proposal.receipt_line_id,
                        expected_current_cost: proposal.current_catalog_cost,
                      })),
                    });
                  }}
                  className="mt-2 rounded bg-amber-700 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                >
                  Actualizar coste y recalcular PVP
                </button>
              )}
              {applyError && <p className="mt-1 text-xs text-red-700">{applyError}</p>}
            </section>
          )}
        </li>
      ))}
    </ul>
  );
}
