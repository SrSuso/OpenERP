import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CategoryTabs } from './CategoryTabs';
import { type PosCategory } from './api';

const CATEGORIES: PosCategory[] = [
  { id: 1, name: 'Bebidas', color: '#3b82f6', display_order: 0, is_active: true },
  { id: 2, name: 'Panadería', color: '#f59e0b', display_order: 1, is_active: true },
];

/** El componente pregunta al servidor qué fotos hay, así que necesita un
 * QueryClient aunque estas pruebas no vayan de fotos. Sin respuesta, la
 * consulta falla y no se pinta ninguna, que es justo el caso de siempre. */
function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('CategoryTabs', () => {
  it('always renders an "Todos" tab in addition to the given categories', () => {
    renderWithQueryClient(
      <CategoryTabs categories={CATEGORIES} selectedId={null} onSelect={vi.fn()} />,
    );

    expect(screen.getByRole('tab', { name: 'Todos' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Bebidas' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Panadería' })).toBeInTheDocument();
  });

  it('marks the selected tab via aria-selected', () => {
    renderWithQueryClient(
      <CategoryTabs categories={CATEGORIES} selectedId={2} onSelect={vi.fn()} />,
    );

    expect(screen.getByRole('tab', { name: 'Panadería' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Todos' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSelect with the category id when a tab is tapped', async () => {
    const onSelect = vi.fn();
    renderWithQueryClient(
      <CategoryTabs categories={CATEGORIES} selectedId={null} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Bebidas' }));

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('calls onSelect with null when "Todos" is tapped', async () => {
    const onSelect = vi.fn();
    renderWithQueryClient(
      <CategoryTabs categories={CATEGORIES} selectedId={1} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Todos' }));

    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
