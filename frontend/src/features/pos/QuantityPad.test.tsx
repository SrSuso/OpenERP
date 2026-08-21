import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { QuantityPad } from './QuantityPad';

function QuantityPadHarness() {
  const [value, setValue] = useState('');
  return <QuantityPad value={value} onChange={setValue} />;
}

describe('QuantityPad', () => {
  it('uses one compact row of consecutive multipliers', async () => {
    render(<QuantityPadHarness />);

    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×1');
    expect(screen.getAllByRole('button')).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: '×4' }));
    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×4');

    await userEvent.click(screen.getByRole('button', { name: '×10' }));
    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×10');

    await userEvent.click(screen.getByRole('button', { name: '×1' }));
    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×1');
  });
});
