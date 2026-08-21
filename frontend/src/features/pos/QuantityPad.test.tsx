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
  it('uses the available control strip for clear quantity presets', async () => {
    render(<QuantityPadHarness />);

    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×1');
    await userEvent.click(screen.getByRole('button', { name: '×5' }));
    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×5');

    await userEvent.click(screen.getByRole('button', { name: '×1' }));
    expect(screen.getByLabelText('Cantidad para el siguiente producto')).toHaveTextContent('×1');
  });
});
