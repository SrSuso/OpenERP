import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';

/**
 * Shared query defaults.
 *
 * Retrying a 401/403/404 is never useful and delays the redirect to the login
 * screen, so those fail fast.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
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
