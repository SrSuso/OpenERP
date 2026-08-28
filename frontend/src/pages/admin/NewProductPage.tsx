import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Alert, PageHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import {
  createProduct,
  posCategoriesQuery,
  productCategoriesQuery,
  unitsQuery,
  type ProductCreateInput,
} from '@/features/catalog/api';
import {
  CreateProductForm,
  type ProductAlertCreateConfig,
} from '@/features/catalog/CreateProductForm';
import { notificationSettingsQuery, updateProductExpiration } from '@/features/notifications/api';
import { setProductPricing, taxesQuery } from '@/features/pricing/api';
import { ApiError } from '@/lib/api';

interface CreationResult {
  productId: number;
  productName: string;
  warning: string | null;
}

export function NewProductPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission, isLoading: isAuthLoading } = useAuth();
  const canReadNotifications = hasPermission('notification.read');
  const canManageNotifications = hasPermission('notification.manage');
  const categories = useQuery(productCategoriesQuery);
  const posCategories = useQuery(posCategoriesQuery);
  const units = useQuery(unitsQuery);
  const taxes = useQuery(taxesQuery);
  const notificationSettings = useQuery({
    ...notificationSettingsQuery,
    enabled: canReadNotifications,
  });
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<CreationResult | null>(null);

  const createMutation = useMutation({
    mutationFn: async ({
      payload,
      taxIds,
      alerts,
    }: {
      payload: ProductCreateInput;
      taxIds: number[];
      alerts: ProductAlertCreateConfig;
    }): Promise<CreationResult> => {
      const created = await createProduct(payload);
      if (taxIds.length > 0) {
        try {
          await setProductPricing(created.id, { tax_ids: taxIds });
        } catch {
          return {
            productId: created.id,
            productName: created.name,
            warning:
              'El producto se ha creado, pero no se pudieron guardar sus impuestos. Revisa la pestaña Precios.',
          };
        }
      }
      if (
        canManageNotifications &&
        payload.track_expiration &&
        alerts.expirationMode === 'CUSTOM'
      ) {
        try {
          await updateProductExpiration(created.id, alerts.expirationDays);
        } catch {
          return {
            productId: created.id,
            productName: created.name,
            warning:
              'El producto y sus precios se han guardado, pero no el aviso de caducidad. Revísalo en Inventario y avisos.',
          };
        }
      }
      return { productId: created.id, productName: created.name, warning: null };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
      void queryClient.invalidateQueries({ queryKey: notificationSettingsQuery.queryKey });
      if (result.warning) {
        setPartial(result);
        return;
      }
      void navigate(`/admin/inventory/products/${result.productId}`);
    },
    onError: (unknownError: unknown) => {
      setError(
        unknownError instanceof ApiError && unknownError.code === 'conflict'
          ? 'Ya existe un producto con esos datos.'
          : 'No se ha podido crear el producto.',
      );
    },
  });

  if (
    isAuthLoading ||
    categories.isPending ||
    posCategories.isPending ||
    units.isPending ||
    taxes.isPending ||
    (canReadNotifications && notificationSettings.isPending)
  ) {
    return <p className="text-sm text-slate-500">Preparando el formulario…</p>;
  }
  if (
    categories.isError ||
    posCategories.isError ||
    units.isError ||
    taxes.isError ||
    (canReadNotifications && (notificationSettings.isError || !notificationSettings.data))
  ) {
    return (
      <Alert tone="error">
        No se han podido cargar los datos necesarios para crear el producto.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/admin/inventory/products"
        className="inline-block rounded text-sm font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        ← Productos
      </Link>
      <PageHeader
        title="Nuevo producto"
        description="Completa los datos básicos, el precio, el inventario y sus avisos."
      />
      {partial && (
        <Alert tone="warning">
          {partial.warning}{' '}
          <Link
            to={`/admin/inventory/products/${partial.productId}`}
            className="font-bold underline"
          >
            Abrir {partial.productName}
          </Link>
        </Alert>
      )}
      {!partial && (
        <CreateProductForm
          categories={categories.data ?? []}
          posCategories={posCategories.data ?? []}
          units={units.data ?? []}
          taxes={taxes.data ?? []}
          generalStockMinimum={notificationSettings.data?.stock_general.min_stock ?? '0'}
          generalExpirationDays={
            notificationSettings.data?.general_expiration.days_before_expiration ?? 7
          }
          canManageNotifications={canManageNotifications}
          isPending={createMutation.isPending}
          submitError={error}
          onCancel={() => void navigate('/admin/inventory/products')}
          onSubmit={(payload, taxIds, alerts) => {
            setError(null);
            createMutation.mutate({ payload, taxIds, alerts });
          }}
        />
      )}
    </div>
  );
}
