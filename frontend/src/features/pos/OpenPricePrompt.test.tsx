import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { type Product } from './api';
import { OpenPricePrompt } from './OpenPricePrompt';

const OPEN_PRICE_PRODUCT: Product = {
  id: 1,
  sku: 'CHARCUTERIA-LIBRE',
  name: 'Venta de charcutería',
  pos_category_id: 1,
  pos_category_name: 'Charcutería',
  is_open_price: true,
  base_unit_name: 'UNIDAD',
  list_price: '0.000000',
  tax_rate: '10.000000',
  is_active: true,
  packages: [],
};

describe('OpenPricePrompt', () => {
  it('treats keypad digits as cents without requiring a decimal separator', async () => {
    const onConfirm = vi.fn();
    render(
      <OpenPricePrompt
        product={OPEN_PRICE_PRODUCT}
        isPending={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    for (const digit of ['1', '2', '5', '0']) {
      await userEvent.click(screen.getByRole('button', { name: digit }));
    }

    expect(screen.getByDisplayValue('12,50 €')).toBeInTheDocument();
    expect(screen.getByText('1250 céntimos')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Añadir al carrito' }));

    expect(onConfirm).toHaveBeenCalledWith('12.50');
  });

  it('moves the decimal point as each digit is entered and supports deletion', async () => {
    render(
      <OpenPricePrompt
        product={OPEN_PRICE_PRODUCT}
        isPending={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '5' }));
    expect(screen.getByDisplayValue('0,05 €')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Borrar un dígito' }));
    expect(screen.getByDisplayValue('0,00 €')).toBeInTheDocument();
  });
});
