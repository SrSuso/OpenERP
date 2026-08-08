import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router';

import { AuthProvider } from '@/features/auth/AuthContext';
import { routes } from '@/routes';

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={createBrowserRouter(routes)} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
