import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiTile } from './KpiTile';

describe('KpiTile', () => {
  it('shows the value', () => {
    render(<KpiTile value="1.234,56 €" />);

    expect(screen.getByText('1.234,56 €')).toBeInTheDocument();
  });

  it('shows no status message by default', () => {
    render(<KpiTile value="0" />);

    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument();
  });

  it('shows the status label alongside the value, never color alone', () => {
    render(<KpiTile value="3" status="warning" statusLabel="por debajo del mínimo" />);

    expect(screen.getByText('por debajo del mínimo')).toBeInTheDocument();
  });
});
