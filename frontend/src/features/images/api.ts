import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { API_V1, apiFetch } from '@/lib/api';

/** Los tres que pueden llevar foto — la misma lista cerrada que
 * `app.catalog.images.IMAGE_OWNERS` en el backend, que es quien decide
 * además qué permiso hace falta para cambiarla. */
export type ImageOwnerType = 'product' | 'product_category' | 'pos_category';

/** Qué dueños de ese tipo tienen foto, y por qué versión van. Se pide una
 * vez por pantalla: así sólo se pinta `<img>` donde hay algo que enseñar,
 * en vez de dejar que cada producto sin foto provoque un 404. */
export function imageVersionsQuery(ownerType: ImageOwnerType) {
  return queryOptions({
    queryKey: ['images', ownerType] as const,
    queryFn: ({ signal }) =>
      apiFetch(`${API_V1}/images/${ownerType}`, {
        schema: z.record(z.string(), z.number()),
        signal,
      }),
  });
}

/** La URL de la foto, con su versión: una URL concreta no cambia nunca de
 * contenido, así que el navegador puede guardarla, y al reemplazarla la
 * versión sube y con ella la URL. */
export function imageUrl(ownerType: ImageOwnerType, id: number, version: number): string {
  return `${API_V1}/images/${ownerType}/${id}?v=${version}`;
}

export const imageReadSchema = z.object({ entity_id: z.number(), version: z.number() });

/** `dataUrl` sale de `resizeToDataUrl`: ya viene recortada. */
export async function putImage(
  ownerType: ImageOwnerType,
  id: number,
  dataUrl: string,
): Promise<{ entity_id: number; version: number }> {
  return apiFetch(`${API_V1}/images/${ownerType}/${id}`, {
    method: 'PUT',
    schema: imageReadSchema,
    body: { data_url: dataUrl },
  });
}

export async function deleteImage(ownerType: ImageOwnerType, id: number): Promise<void> {
  await apiFetch(`${API_V1}/images/${ownerType}/${id}`, { method: 'DELETE', schema: z.null() });
}
