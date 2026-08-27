import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkout } from './Checkout';
import { type Sale } from './api';

const SALE: Sale = {
  id: 1,
  warehouse_id: 1,
  location_id: 1,
  terminal_id: 7,
  terminal_name: 'Caja 1',
  status: 'DRAFT',
  number: null,
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
  it('opens the optional cash amount prompt after choosing cash', async () => {
    const onConfirm = vi.fn();
    renderCheckout({ onConfirm });

    expect(screen.queryByRole('dialog', { name: 'Importe recibido' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^efectivo$/i }));

    const dialog = screen.getByRole('dialog', { name: 'Importe recibido' });
    expect(within(dialog).getByText('Total de la venta')).toBeInTheDocument();
    expect(within(dialog).getByText('20,00 €')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Importe recibido')).toHaveValue('0,00 €');
    expect(within(dialog).getByText('0 céntimos')).toBeInTheDocument();
    // Vacío equivale explícitamente a que el cliente entrega el importe exacto.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar efectivo' }));

    expect(onConfirm).toHaveBeenCalledWith([{ method: 'CASH', amount: '20.00' }]);
  });

  it('selecting "Tarjeta" does not ask for an amount and charges the exact total', async () => {
    const onConfirm = vi.fn();
    renderCheckout({ onConfirm });

    await userEvent.click(screen.getByRole('button', { name: /^tarjeta$/i }));
    expect(screen.queryByRole('dialog', { name: 'Importe recibido' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /confirmar cobro/i }));

    expect(onConfirm).toHaveBeenCalledWith([{ method: 'CARD', amount: '20.00' }]);
  });

  it('disables confirming and warns when the amount does not cover the total', async () => {
    renderCheckout();
    await userEvent.click(screen.getByRole('button', { name: /^efectivo$/i }));
    const dialog = screen.getByRole('dialog', { name: 'Importe recibido' });
    const keypad = within(dialog).getByLabelText('Teclado numérico para efectivo');

    await userEvent.click(within(keypad).getByRole('button', { name: '5' }));

    expect(within(dialog).getByText(/no cubre el total/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirmar efectivo' })).toBeDisabled();
  });

  it('previews the change for a cash overpayment', async () => {
    renderCheckout();
    await userEvent.click(screen.getByRole('button', { name: /^efectivo$/i }));
    const dialog = screen.getByRole('dialog', { name: 'Importe recibido' });
    const keypad = within(dialog).getByLabelText('Teclado numérico para efectivo');

    for (const digit of ['5', '0', '0', '0']) {
      await userEvent.click(within(keypad).getByRole('button', { name: digit }));
    }

    expect(within(dialog).getByText(/cambio/i)).toBeInTheDocument();
    expect(within(dialog).getByText('30,00 €')).toBeInTheDocument();
  });

  it('lets the cashier enter cash with the auxiliary keypad', async () => {
    renderCheckout();
    await userEvent.click(screen.getByRole('button', { name: /^efectivo$/i }));
    const dialog = screen.getByRole('dialog', { name: 'Importe recibido' });
    const input = within(dialog).getByLabelText('Importe recibido');
    const keypad = within(dialog).getByLabelText('Teclado numérico para efectivo');

    // No hay un total precargado que borrar: el teclado empieza vacío y recibe céntimos.
    await userEvent.click(within(keypad).getByRole('button', { name: '5' }));
    await userEvent.click(within(keypad).getByRole('button', { name: '0' }));

    expect(input).toHaveValue('0,50 €');
    expect(within(dialog).getByText('50 céntimos')).toBeInTheDocument();
  });

  it('confirms with the method and tendered amount', async () => {
    const onConfirm = vi.fn();
    renderCheckout({ onConfirm });
    await userEvent.click(screen.getByRole('button', { name: /^efectivo$/i }));
    const dialog = screen.getByRole('dialog', { name: 'Importe recibido' });
    const keypad = within(dialog).getByLabelText('Teclado numérico para efectivo');
    for (const digit of ['5', '0', '0', '0']) {
      await userEvent.click(within(keypad).getByRole('button', { name: digit }));
    }

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar efectivo' }));

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
    // Arranca en tarjeta, así que no hace falta pedir importe recibido.
    expect(screen.getByRole('button', { name: 'Tarjeta' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog', { name: 'Importe recibido' })).not.toBeInTheDocument();
  });

  it('hides the third payment button unless the shop turns it on', () => {
    renderCheckoutWithSettings({ 'pos.show_other_payment': 'false' });

    expect(screen.queryByRole('button', { name: 'Otro' })).not.toBeInTheDocument();
  });
});
