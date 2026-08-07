import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

export const healthSchema = z.object({
  status: z.literal('ok'),
  app: z.string(),
  environment: z.string(),
});

export type Health = z.infer<typeof healthSchema>;

export const healthQuery = queryOptions({
  queryKey: ['health', 'live'] as const,
  queryFn: ({ signal }) => apiFetch(`${API_V1}/health/live`, { schema: healthSchema, signal }),
});
