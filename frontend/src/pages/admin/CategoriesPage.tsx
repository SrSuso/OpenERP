import { useAuth } from '@/features/auth/useAuth';
import { PosCategoriesPanel } from '@/features/catalog/PosCategoriesPanel';
import { ProductCategoriesPanel } from '@/features/catalog/ProductCategoriesPanel';
import { UnitsPanel } from '@/features/catalog/UnitsPanel';

export function CategoriesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('product.manage');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProductCategoriesPanel canManage={canManage} />
      <PosCategoriesPanel canManage={hasPermission('pos_category.manage')} />
      <UnitsPanel canManage={canManage} />
    </div>
  );
}
