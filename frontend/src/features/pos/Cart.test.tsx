import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Cart } from './Cart';
import { type Sale, type SaleLine } from './api';

const MILK_LINE: SaleLine = {
  id: 100,
  product_id: 1,
  product_sku: 'LECHE-1L',
  product_name: 'Leche entera 1L',
  package_id: 10,
  package_name: 'Brick',
  quantity_packages: '2.000000',
  quantity_base: '2.000000',
  quantity_returned: '0.000000',
  unit_price: '1.200000',
  tax_rate: '10.000000',
  discount_rate: '0.000000',
  subtotal: '2.400000',
  discount_amount: '0.000000',
  tax_amount: '0.240000',
  total: '2.640000',
};

const SALE: Sale = {
  id: 1,
  warehouse_id: 1,
  location_id: 1,
  status: 'DRAFT',
  notes: '',
  created_at: '2026-08-11T10:00:00Z',
  lines: [MILK_LINE],
  total: '2.640000',
  payments: [],
  change_due: '0.000000',
};

const EMPTY_SALE: Sale = { ...SALE, lines: [], total: '0.000000' };

function renderCart(overrides: Partial<Parameters<typeof Cart>[0]> = {}) {
  return render(
    <Cart
      sale={SALE}
      onRemoveLine={vi.fn()}
      onCancelSale={vi.fn()}
      onCheckout={vi.fn()}
      {...overrides}
    />,
  );
}

describe('Cart', () => {
  it('shows an empty-cart message when there is no sale yet or it has no lines', () => {
    renderCart({ sale: null });

    expect(screen.getByText(/el carrito está vacío/i)).toBeInTheDocument();
    expect(screen.getByText('0,00 €')).toBeInTheDocument();
  });

  it('lists each line with its quantity, package and formatted total', () => {
    renderCart();

    expect(screen.getByText('Leche entera 1L')).toBeInTheDocument();
    expect(screen.getByText(/2 × brick/i)).toBeInTheDocument();
    expect(screen.getAllByText('2,64 €').length).toBeGreaterThan(0);
  });

  it('shows the sale total', () => {
    renderCart();

    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getAllByText('2,64 €').length).toBeGreaterThan(0);
  });

  it('calls onRemoveLine with the tapped line', async () => {
    const onRemoveLine = vi.fn();
    renderCart({ onRemoveLine });

    await userEvent.click(screen.getByRole('button', { name: /quitar leche entera 1l/i }));

    expect(onRemoveLine).toHaveBeenCalledWith(MILK_LINE);
  });

  it('calls onCancelSale when "Cancelar venta" is tapped', async () => {
    const onCancelSale = vi.fn();
    renderCart({ onCancelSale });

    await userEvent.click(screen.getByRole('button', { name: /cancelar venta/i }));

    expect(onCancelSale).toHaveBeenCalled();
  });

  it('disables "Cancelar venta" when there is no open sale', () => {
    renderCart({ sale: null });

    expect(screen.getByRole('button', { name: /cancelar venta/i })).toBeDisabled();
  });

  it('calls onCheckout when "Cobrar" is tapped', async () => {
    const onCheckout = vi.fn();
    renderCart({ onCheckout });

    await userEvent.click(screen.getByRole('button', { name: /^cobrar$/i }));

    expect(onCheckout).toHaveBeenCalled();
  });

  it('disables "Cobrar" when the cart has no lines', () => {
    renderCart({ sale: EMPTY_SALE });

    expect(screen.getByRole('button', { name: /^cobrar$/i })).toBeDisabled();
  });

  it('disables "Cobrar" when there is no open sale', () => {
    renderCart({ sale: null });

    expect(screen.getByRole('button', { name: /^cobrar$/i })).toBeDisabled();
  });
});
