import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Receipt } from './Receipt';
import { type Sale } from './api';

const PAID_SALE: Sale = {
  id: 1,
  warehouse_id: 1,
  location_id: 1,
  status: 'COMPLETED',
  notes: '',
  lines: [],
  total: '20.000000',
  payments: [{ id: 1, method: 'CASH', amount: '50.000000', created_at: '2026-08-08T10:00:00Z' }],
  change_due: '30.000000',
};

describe('Receipt', () => {
  it('shows the total charged', () => {
    render(<Receipt sale={PAID_SALE} onDismiss={vi.fn()} />);

    expect(screen.getByText('20,00 €')).toBeInTheDocument();
  });

  it('lists each payment by method', () => {
    render(<Receipt sale={PAID_SALE} onDismiss={vi.fn()} />);

    expect(screen.getByText('Efectivo')).toBeInTheDocument();
    expect(screen.getByText('50,00 €')).toBeInTheDocument();
  });

  it('shows the change due when there is any', () => {
    render(<Receipt sale={PAID_SALE} onDismiss={vi.fn()} />);

    expect(screen.getByText(/cambio a entregar/i)).toBeInTheDocument();
    expect(screen.getByText('30,00 €')).toBeInTheDocument();
  });

  it('hides the change block for an exact payment', () => {
    render(<Receipt sale={{ ...PAID_SALE, change_due: '0.000000' }} onDismiss={vi.fn()} />);

    expect(screen.queryByText(/cambio a entregar/i)).not.toBeInTheDocument();
  });

  it('calls onDismiss when "Nueva venta" is tapped', async () => {
    const onDismiss = vi.fn();
    render(<Receipt sale={PAID_SALE} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole('button', { name: /nueva venta/i }));

    expect(onDismiss).toHaveBeenCalled();
  });
});
