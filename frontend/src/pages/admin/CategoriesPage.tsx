import { useAuth } from '@/features/auth/AuthContext';
import { PosCategoriesPanel } from '@/features/catalog/PosCategoriesPanel';
import { ProductCategoriesPanel } from '@/features/catalog/ProductCategoriesPanel';

export function CategoriesPage() {
  const { hasPermission } = useAuth();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ProductCategoriesPanel canManage={hasPermission('product.manage')} />
      <PosCategoriesPanel canManage={hasPermission('pos_category.manage')} />
    </div>
  );
}
