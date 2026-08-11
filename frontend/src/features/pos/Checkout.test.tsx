import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkout } from './Checkout';
import { type Sale } from './api';

const SALE: Sale = {
  id: 1,
  warehouse_id: 1,
  location_id: 1,
  status: 'DRAFT',
  notes: '',
  created_at: '2026-08-11T10:00:00Z',
  lines: [],
  total: '20.000000',
  payments: [],
  change_due: '0.000000',
};

/** Igual que `renderCheckout`, pero con los ajustes de tienda ya en caché:
 * evita depender de la red y deja el test centrado en el efecto. */
function renderCheckoutWithSettings(values: Record<string, string>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(['settings', 'values'], values);
  return render(
    <QueryClientProvider client={queryClient}>
      <Checkout sale={SALE} isPending={false} error={null} onConfirm={vi.fn()} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

function renderCheckout(overrides: Partial<Parameters<typeof Checkout>[0]> = {}) {
  // La caja lee los ajustes de tienda (nombre de cada forma de pago, cuál
  // sale marcada) — sin red en el test, así que cae a los valores por
  // defecto, que es justo lo que estas pruebas dan por supuesto.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Checkout
        sale={SALE}
        isPending={false}
        error={null}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe('Checkout', () => {
  it('defaults the tendered amount to the sale total, selected as cash', () => {
    renderCheckout();

    expect(screen.getByLabelText(/importe recibido/i)).toHaveValue('20.00');
    expect(screen.getByRole('button', { name: /confirmar cobro/i })).toBeEnabled();
  });

  it('selecting "Tarjeta" locks the amount to the exact total', async () => {
    renderCheckout();

    await userEvent.click(screen.getByRole('button', { name: /^tarjeta$/i }));

    const input = screen.getByLabelText(/^importe$/i);
    expect(input).toHaveValue('20.00');
    expect(input).toBeDisabled();
  });

  it('disables confirming and warns when the amount does not cover the total', async () => {
    renderCheckout();
    const input = screen.getByLabelText(/importe recibido/i);

    await userEvent.clear(input);
    await userEvent.type(input, '5');

    expect(screen.getByText(/no cubre el total/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar cobro/i })).toBeDisabled();
  });

  it('previews the change for a cash overpayment', async () => {
    renderCheckout();
    const input = screen.getByLabelText(/importe recibido/i);

    await userEvent.clear(input);
    await userEvent.type(input, '50');

    expect(screen.getByText(/cambio/i)).toBeInTheDocument();
    expect(screen.getByText('30,00 €')).toBeInTheDocument();
  });

  it('confirms with the method and tendered amount', async () => {
    const onConfirm = vi.fn();
    renderCheckout({ onConfirm });
    const input = screen.getByLabelText(/importe recibido/i);
    await userEvent.clear(input);
    await userEvent.type(input, '50');

    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));

    expect(onConfirm).toHaveBeenCalledWith([{ method: 'CASH', amount: '50.00' }]);
  });

  it('calls onBack when "Volver" is tapped', async () => {
    const onBack = vi.fn();
    renderCheckout({ onBack });

    await userEvent.click(screen.getByRole('button', { name: /volver/i }));

    expect(onBack).toHaveBeenCalled();
  });

  it('shows the error message when checkout failed', () => {
    renderCheckout({ error: 'No hay stock suficiente.' });

    expect(screen.getByRole('alert')).toHaveTextContent('No hay stock suficiente.');
  });

  it('disables confirming while pending', () => {
    renderCheckout({ isPending: true });

    expect(screen.getByRole('button', { name: /cobrando/i })).toBeDisabled();
  });
  it("uses the shop's own payment wording, third button and default method", () => {
    renderCheckoutWithSettings({
      'pos.default_payment_method': 'CARD',
      'pos.show_other_payment': 'true',
      'ticket.label_cash': 'Metálico',
      'ticket.label_card': 'Tarjeta',
      'ticket.label_other': 'Bizum',
    });

    expect(screen.getByRole('button', { name: 'Metálico' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bizum' })).toBeInTheDocument();
    // Arranca en tarjeta, así que el importe queda clavado al total.
    expect(screen.getByLabelText('Importe')).toHaveValue('20.00');
  });

  it('hides the third payment button unless the shop turns it on', () => {
    renderCheckoutWithSettings({ 'pos.show_other_payment': 'false' });

    expect(screen.queryByRole('button', { name: 'Otro' })).not.toBeInTheDocument();
  });
});
