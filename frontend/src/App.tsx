import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RouterProvider, createBrowserRouter } from 'react-router';

import { routes } from '@/routes';

export function App({ queryClient }: { queryClient: QueryClient }) {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </QueryClientProvider>
  );
}
