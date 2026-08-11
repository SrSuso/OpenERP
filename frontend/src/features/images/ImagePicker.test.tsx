import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImagePicker } from './ImagePicker';

// El recorte de verdad usa canvas y createImageBitmap, que jsdom no tiene:
// lo que se prueba aquí es lo que rodea a eso (qué se manda, qué se pide y
// qué se enseña), no el reescalado en sí.
vi.mock('./resize', () => ({
  resizeToDataUrl: () => Promise.resolve('data:image/jpeg;base64,YWJj'),
}));

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function stubBackend(versions: Record<string, number>) {
  const puts: { url: string; dataUrl: string }[] = [];
  const deletes: string[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';

      if (method === 'GET') return Promise.resolve(jsonResponse(versions));
      if (method === 'PUT') {
        const body = JSON.parse(init?.body as string) as { data_url: string };
        puts.push({ url, dataUrl: body.data_url });
        versions['7'] = (versions['7'] ?? 0) + 1;
        return Promise.resolve(jsonResponse({ entity_id: 7, version: versions['7'] }));
      }
      if (method === 'DELETE') {
        deletes.push(url);
        delete versions['7'];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unexpected ${method} ${url}`));
    }),
  );

  return { puts, deletes };
}

function renderPicker(canManage = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ImagePicker ownerType="product" ownerId={7} ownerName="Tomate" canManage={canManage} />
    </QueryClientProvider>,
  );
}

describe('ImagePicker', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('uploads the chosen photo already resized', async () => {
    const backend = stubBackend({});
    renderPicker();

    expect(await screen.findByText('Sin foto')).toBeInTheDocument();

    const file = new File(['x'], 'tomate.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Poner foto'), file);

    expect(backend.puts).toEqual([
      { url: '/api/v1/images/product/7', dataUrl: 'data:image/jpeg;base64,YWJj' },
    ]);
    // Y pasa a enseñarse, con la versión en la URL para que el navegador no
    // se quede con la anterior.
    const image = await screen.findByRole('img', { name: 'Tomate' });
    expect(image).toHaveAttribute('src', '/api/v1/images/product/7?v=1');
  });

  it('asks before removing the photo', async () => {
    const backend = stubBackend({ '7': 3 });
    renderPicker();
    await screen.findByRole('img', { name: 'Tomate' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(backend.deletes).toEqual([]);

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));

    expect(backend.deletes).toEqual(['/api/v1/images/product/7']);
    confirm.mockRestore();
  });

  it('shows the photo but no controls without permission to manage it', async () => {
    stubBackend({ '7': 1 });
    renderPicker(false);

    expect(await screen.findByRole('img', { name: 'Tomate' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Cambiar foto')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  });
});
