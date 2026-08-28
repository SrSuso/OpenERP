import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const printMocks = vi.hoisted(() => ({
  thermal: vi.fn(() => Promise.reject(new Error('QZ no disponible'))),
}));

vi.mock('./qzPrinter', () => ({ printThermalTicket: printMocks.thermal }));

import { TicketPrintSurface } from './TicketPrintSurface';

const PROFILE = {
  printable_width_mm: 72,
  margin_left_mm: 4,
  margin_right_mm: 4,
  font_family: 'COURIER_NEW' as const,
  font_size_px: 12,
  line_height_px: 20,
  font_weight: 'NORMAL' as const,
  margin_top_mm: 0,
  margin_bottom_mm: 0,
};

describe('TicketPrintSurface', () => {
  it('shows a useful QZ error and keeps browser printing as an explicit fallback', async () => {
    const onDismiss = vi.fn();
    const browserPrint = vi.fn();
    vi.stubGlobal('print', browserPrint);
    render(<TicketPrintSurface text={'TOTAL 1.25 €\n'} profile={PROFILE} onDismiss={onDismiss} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('QZ no disponible');
    expect(screen.getByAltText('Vista previa exacta del ticket térmico')).toHaveAttribute(
      'data-ticket-preview-text',
      'TOTAL 1.25 €\n',
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Imprimir con el navegador (alternativa)' }),
    );
    await waitFor(() => expect(browserPrint).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll(".ticket-print-root[data-print-active='true']")).toHaveLength(
      1,
    );

    await act(() => window.dispatchEvent(new Event('afterprint')));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll(".ticket-print-root[data-print-active='true']")).toHaveLength(
      0,
    );
  });
});
