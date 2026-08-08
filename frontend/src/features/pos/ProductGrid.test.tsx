import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProductGrid } from './ProductGrid';
import { type Product } from './api';

const MILK: Product = {
  id: 1,
  sku: 'LECHE-1L',
  name: 'Leche entera 1L',
  pos_category_id: 1,
  pos_category_name: 'Bebidas',
  list_price: '1.200000',
  tax_rate: '10.000000',
  is_active: true,
  packages: [
    { id: 10, name: 'Brick', factor: '1.000000', is_base: true, barcodes: ['8410000000010'] },
  ],
};

describe('ProductGrid', () => {
  it('shows a loading message while pending', () => {
    render(<ProductGrid products={[]} isPending isError={false} onPick={vi.fn()} />);

    expect(screen.getByText(/cargando productos/i)).toBeInTheDocument();
  });

  it('shows an error message when the query failed', () => {
    render(<ProductGrid products={[]} isPending={false} isError onPick={vi.fn()} />);

    expect(screen.getByText(/no se pudieron cargar/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no products in the category', () => {
    render(<ProductGrid products={[]} isPending={false} isError={false} onPick={vi.fn()} />);

    expect(screen.getByText(/no hay productos en esta categoría/i)).toBeInTheDocument();
  });

  it('renders a button per product with its name and formatted price', () => {
    render(<ProductGrid products={[MILK]} isPending={false} isError={false} onPick={vi.fn()} />);

    const button = screen.getByRole('button', { name: /leche entera 1l/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('1,20 €');
  });

  it('calls onPick with the product when tapped', async () => {
    const onPick = vi.fn();
    render(<ProductGrid products={[MILK]} isPending={false} isError={false} onPick={onPick} />);

    await userEvent.click(screen.getByRole('button', { name: /leche entera 1l/i }));

    expect(onPick).toHaveBeenCalledWith(MILK);
  });

  it('disables every product button while disabled', () => {
    render(
      <ProductGrid products={[MILK]} isPending={false} isError={false} onPick={vi.fn()} disabled />,
    );

    expect(screen.getByRole('button', { name: /leche entera 1l/i })).toBeDisabled();
  });
});
