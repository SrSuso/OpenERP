import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type Product } from '@/features/pos/api';

import { ProductSearchDialog } from './ProductSearchDialog';

const MILK: Product = {
  id: 1,
  sku: 'LECHE-1L',
  name: 'Leche entera 1L',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  base_unit_name: 'L',
  list_price: '1.200000',
  tax_rate: '10.000000',
  is_active: true,
  packages: [{ id: 10, name: 'L', factor: '1.000000', is_base: true, barcodes: [] }],
};

describe('ProductSearchDialog', () => {
  it('offers an on-screen keyboard and lets the cashier add a matching product', async () => {
    const onQueryChange = vi.fn();
    const onPick = vi.fn();
    render(
      <ProductSearchDialog
        query="LECHE"
        onQueryChange={onQueryChange}
        products={[MILK]}
        isPending={false}
        isError={false}
        disabled={false}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onQueryChange).toHaveBeenCalledWith('LECHEA');

    await userEvent.click(screen.getByRole('button', { name: /Leche entera 1L/ }));
    expect(onPick).toHaveBeenCalledWith(MILK);
  });
});
