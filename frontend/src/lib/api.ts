import { z } from 'zod';

/** Base URL of the API. Empty string means "same origin" (dev goes through the Vite proxy). */
export const API_BASE_URL = import.meta.env['VITE_API_BASE_URL'] ?? '';

export const API_V1 = '/api/v1';

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).default({}),
  }),
  request_id: z.string().nullable().optional(),
});

/**
 * A failed API call.
 *
 * `code` is the backend's stable error code (`not_found`, `permission_denied`,
 * …) — UI logic should branch on that, never on the message text.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export interface RequestOptions<T> extends Omit<RequestInit, 'body'> {
  /** Zod schema the response body must satisfy. */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** JSON request body; serialised automatically. */
  body?: unknown;
}

async function readErrorBody(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('X-Request-ID');
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new ApiError({
      status: response.status,
      code: 'invalid_response',
      message: response.statusText || 'Request failed.',
      requestId,
    });
  }

  const parsed = errorEnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    return new ApiError({
      status: response.status,
      code: 'invalid_response',
      message: 'The server returned an unrecognised error payload.',
      requestId,
    });
  }

  return new ApiError({
    status: response.status,
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    details: parsed.data.error.details,
    requestId: parsed.data.request_id ?? requestId,
  });
}

/**
 * Typed API call.
 *
 * Every response is validated against a Zod schema, so a backend change that
 * breaks a contract surfaces at the boundary instead of as `undefined` deep in
 * a component.
 */
export async function apiFetch<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const { schema, body, headers, ...init } = options;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      // Todas las llamadas iniciadas desde la caja usan la cookie POS, no
      // la sesión de administración que pueda coexistir en el navegador.
      ...(typeof window !== 'undefined' && window.location.pathname.startsWith('/pos')
        ? { 'X-OpenERP-Session-Surface': 'pos' }
        : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw await readErrorBody(response);
  }

  const payload: unknown = response.status === 204 ? null : await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: 'invalid_response',
      message: `Response did not match the expected shape: ${parsed.error.message}`,
      requestId: response.headers.get('X-Request-ID'),
    });
  }
  return parsed.data;
}
