import { Navigate, useParams } from 'react-router';

/** Enlace viejo `/admin/catalog/products/:productId` (de antes de que la
 * ficha de producto se mudara bajo /admin/inventory) — a diferencia de los
 * demás enlaces viejos en routes.tsx, éste lleva un parámetro, así que no
 * basta un `<Navigate>` estático. */
export function CatalogProductRedirect() {
  const { productId } = useParams<{ productId: string }>();
  return <Navigate to={`/admin/inventory/products/${productId}`} replace />;
}
