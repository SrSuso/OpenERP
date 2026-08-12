import { MutationCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';
import { broadcastChange } from './changeBroadcast';

/**
 * Shared query defaults.
 *
 * Retrying a 401/403/404 is never useful and delays the redirect to the login
 * screen, so those fail fast.
 *
 * Y cada vez que algo se guarda con éxito —sea lo que sea y desde donde
 * sea— se avisa a las demás pestañas del navegador, para que la caja
 * recoja el cambio en el acto sin tener que recargarla (ver
 * `changeBroadcast` y `useLiveCatalog`).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: () => broadcastChange(),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) {
            return false;
          }
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
