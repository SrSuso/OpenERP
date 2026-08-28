import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

const qzSecuritySchema = z.object({
  enabled: z.boolean(),
  certificate: z.string().nullable(),
});

const qzSignatureSchema = z.object({ signature: z.string().min(1) });

export async function getQzSecurity() {
  return apiFetch(`${API_V1}/printing/qz/security`, { schema: qzSecuritySchema });
}

export async function signQzDigest(digest: string): Promise<string> {
  const result = await apiFetch(`${API_V1}/printing/qz/sign`, {
    method: 'POST',
    schema: qzSignatureSchema,
    body: { digest },
  });
  return result.signature;
}
