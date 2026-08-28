import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Alert, Button, Card, EmptyState, PageHeader } from './index';

describe('admin UI foundations', () => {
  it('provides a clear page hierarchy and primary action', async () => {
    const onClick = vi.fn();
    render(
      <PageHeader
        title="Productos"
        description="Gestiona los productos disponibles."
        actions={<Button onClick={onClick}>Nuevo producto</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Productos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('uses semantic, understandable feedback and empty states', () => {
    render(
      <Card>
        <Alert tone="error">No se han podido guardar los cambios.</Alert>
        <EmptyState title="No hay resultados" description="Prueba con otra búsqueda." />
      </Card>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('No se han podido guardar los cambios.');
    expect(screen.getByText('No hay resultados')).toBeInTheDocument();
    expect(screen.getByText('Prueba con otra búsqueda.')).toBeInTheDocument();
  });
});
