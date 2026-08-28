import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormField } from './FormField';
import { Input } from './Input';

describe('FormField and Input', () => {
  it('associates the label, hint and validation error with a reusable input', () => {
    const { rerender } = render(
      <FormField label="Avisar con" htmlFor="days" hint="Días de antelación.">
        <Input id="days" type="number" />
      </FormField>,
    );

    expect(screen.getByLabelText('Avisar con')).toHaveAttribute('type', 'number');
    expect(screen.getByText('Días de antelación.')).toBeInTheDocument();

    rerender(
      <FormField label="Avisar con" htmlFor="days" error="Introduce un valor válido.">
        <Input id="days" type="number" />
      </FormField>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Introduce un valor válido.');
    expect(screen.queryByText('Días de antelación.')).not.toBeInTheDocument();
  });
});
