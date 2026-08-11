import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import {
  deleteImage,
  imageUrl,
  imageVersionsQuery,
  putImage,
  type ImageOwnerType,
} from '@/features/images/api';
import { resizeToDataUrl } from '@/features/images/resize';

interface ImagePickerProps {
  ownerType: ImageOwnerType;
  ownerId: number;
  /** Para el texto alternativo y para la pregunta al quitarla. */
  ownerName: string;
  canManage: boolean;
  /** `sm` para una fila de una lista, `lg` para una ficha. */
  size?: 'sm' | 'lg';
}

const BOX = { sm: 'h-12 w-12', lg: 'h-32 w-32' } as const;

/** Poner, cambiar o quitar la foto de un producto o de una categoría, en
 * el sitio donde se gestiona esa cosa. La foto se recorta en el navegador
 * antes de subirla (ver `resize.ts`).
 *
 * Quien no pueda gestionarla ve la foto y nada más; el botón escondido no
 * es la seguridad, el backend comprueba el permiso igual (regla 11). */
export function ImagePicker({
  ownerType,
  ownerId,
  ownerName,
  canManage,
  size = 'sm',
}: ImagePickerProps) {
  const inputId = useId();
  const queryClient = useQueryClient();
  const versions = useQuery(imageVersionsQuery(ownerType));
  const [error, setError] = useState<string | null>(null);

  const version = versions.data?.[String(ownerId)];

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: imageVersionsQuery(ownerType).queryKey });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => putImage(ownerType, ownerId, await resizeToDataUrl(file)),
    onSuccess: () => {
      refresh();
      setError(null);
    },
    onError: () => setError('No se ha podido guardar la imagen.'),
  });

  const removeMutation = useMutation({
    mutationFn: () => deleteImage(ownerType, ownerId),
    onSuccess: () => {
      refresh();
      setError(null);
    },
    onError: () => setError('No se ha podido quitar la imagen.'),
  });

  const busy = uploadMutation.isPending || removeMutation.isPending;

  return (
    <div className="flex items-center gap-2">
      <div
        className={`${BOX[size]} flex shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50`}
      >
        {version === undefined ? (
          <span className="text-xs text-slate-400">Sin foto</span>
        ) : (
          <img
            src={imageUrl(ownerType, ownerId, version)}
            alt={ownerName}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {canManage && (
        <div className="flex flex-col gap-0.5">
          {/* El <input type="file"> de serie enseña "Ningún archivo
              seleccionado" y no se puede quitar: se esconde y se pulsa
              desde su etiqueta, que sí se puede escribir. */}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Se limpia para que elegir dos veces la misma foto vuelva a
              // disparar el cambio.
              event.target.value = '';
              if (file) uploadMutation.mutate(file);
            }}
          />
          <label
            htmlFor={inputId}
            className="cursor-pointer text-xs font-medium text-brand-700 hover:underline"
          >
            {busy ? 'Guardando…' : version === undefined ? 'Poner foto' : 'Cambiar foto'}
          </label>
          {version !== undefined && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`¿Quitar la foto de «${ownerName}»?`)) removeMutation.mutate();
              }}
              className="text-left text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              Quitar
            </button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
