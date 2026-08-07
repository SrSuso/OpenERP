import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, apiFetch } from './api';

function jsonResponse(body: unknown, init: ResponseInit & { requestId?: string } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.requestId) {
    headers.set('X-Request-ID', init.requestId);
  }
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function stubFetch(response: Response) {
  const spy = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const schema = z.object({ id: z.number(), sku: z.string() });

describe('apiFetch', () => {
  it('returns the parsed body when it matches the schema', async () => {
    stubFetch(jsonResponse({ id: 1, sku: 'LECHE-1L' }));

    await expect(apiFetch('/api/v1/products/1', { schema })).resolves.toEqual({
      id: 1,
      sku: 'LECHE-1L',
    });
  });

  it('sends a JSON body and content type for writes', async () => {
    const spy = stubFetch(jsonResponse({ id: 1, sku: 'LECHE-1L' }));

    await apiFetch('/api/v1/products', {
      schema,
      method: 'POST',
      body: { sku: 'LECHE-1L' },
    });

    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ sku: 'LECHE-1L' }));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('turns the error envelope into an ApiError', async () => {
    stubFetch(
      jsonResponse(
        {
          error: {
            code: 'permission_denied',
            message: 'Missing permission user.write.',
            details: { permission: 'user.write' },
          },
          request_id: 'req-123',
        },
        { status: 403 },
      ),
    );

    const error = await apiFetch('/api/v1/users', { schema }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe('permission_denied');
    expect(apiError.message).toBe('Missing permission user.write.');
    expect(apiError.details).toEqual({ permission: 'user.write' });
    expect(apiError.requestId).toBe('req-123');
    expect(apiError.isForbidden).toBe(true);
  });

  it('reports a schema mismatch instead of returning malformed data', async () => {
    stubFetch(jsonResponse({ id: 'not-a-number', sku: 'X' }));

    const error = await apiFetch('/api/v1/products/1', { schema }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_response');
  });

  it('handles an error response that is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>502</html>', { status: 502 }))),
    );

    const error = (await apiFetch('/api/v1/products/1', { schema }).catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(error.status).toBe(502);
    expect(error.code).toBe('invalid_response');
  });
});
