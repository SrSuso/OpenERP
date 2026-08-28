import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

// Mirrors backend/app/reports/rules.py's whitelist — un informe sólo
// puede combinar claves de esta lista, nunca nombres de columna sueltos.
export const REPORT_SUBJECTS = ['SALES', 'PURCHASES', 'INVENTORY_MOVEMENTS'] as const;
export type ReportSubject = (typeof REPORT_SUBJECTS)[number];

export const reportFieldInfoSchema = z.object({ key: z.string(), label: z.string() });
export type ReportFieldInfo = z.infer<typeof reportFieldInfoSchema>;

export const reportSubjectInfoSchema = z.object({
  subject: z.enum(REPORT_SUBJECTS),
  label: z.string(),
  dimensions: z.array(reportFieldInfoSchema),
  metrics: z.array(reportFieldInfoSchema),
  filter_keys: z.array(z.string()),
});
export type ReportSubjectInfo = z.infer<typeof reportSubjectInfoSchema>;

export const reportSubjectsQuery = queryOptions({
  queryKey: ['reports', 'subjects'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/report-subjects`, {
      schema: z.array(reportSubjectInfoSchema),
      signal,
    }),
});

export interface ReportFilters {
  date_from?: string | null;
  date_to?: string | null;
  warehouse_id?: number | null;
  category_id?: number | null;
  product_id?: number | null;
  supplier_id?: number | null;
  cashier_user_id?: number | null;
  movement_type?: string | null;
}

export const reportRunResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
});
export type ReportRunResult = z.infer<typeof reportRunResultSchema>;

export interface ReportRunRequest {
  subject: ReportSubject;
  dimensions: string[];
  metrics: string[];
  filters: ReportFilters;
}

export async function runReport(
  payload: ReportRunRequest,
  signal?: AbortSignal,
): Promise<ReportRunResult> {
  return apiFetch(`${API_V1}/reports/run`, {
    method: 'POST',
    schema: reportRunResultSchema,
    body: payload,
    ...(signal === undefined ? {} : { signal }),
  });
}

// --- informes guardados ------------------------------------------------

export const reportDefinitionSchema = z.object({
  id: z.number(),
  name: z.string(),
  subject: z.enum(REPORT_SUBJECTS),
  dimensions: z.array(z.string()),
  metrics: z.array(z.string()),
  filters: z.record(z.unknown()),
  created_at: z.string(),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const reportDefinitionsQuery = queryOptions({
  queryKey: ['reports', 'definitions'] as const,
  queryFn: ({ signal }) =>
    apiFetch(`${API_V1}/report-definitions`, {
      schema: z.array(reportDefinitionSchema),
      signal,
    }),
});

export async function createReportDefinition(
  payload: ReportRunRequest & { name: string },
): Promise<ReportDefinition> {
  return apiFetch(`${API_V1}/report-definitions`, {
    method: 'POST',
    schema: reportDefinitionSchema,
    body: payload,
  });
}

export async function runReportDefinition(id: number): Promise<ReportRunResult> {
  return apiFetch(`${API_V1}/report-definitions/${id}/run`, {
    method: 'POST',
    schema: reportRunResultSchema,
  });
}

export async function deleteReportDefinition(id: number): Promise<void> {
  await apiFetch(`${API_V1}/report-definitions/${id}`, { method: 'DELETE', schema: z.null() });
}
