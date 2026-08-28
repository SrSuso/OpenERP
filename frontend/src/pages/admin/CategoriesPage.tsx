import { useState } from 'react';

import { PageHeader } from '@/components/ui';
import { useAuth } from '@/features/auth/useAuth';
import { PosCategoriesPanel } from '@/features/catalog/PosCategoriesPanel';
import { ProductCategoriesPanel } from '@/features/catalog/ProductCategoriesPanel';
import { UnitsPanel } from '@/features/catalog/UnitsPanel';
import { confirmDiscard } from '@/lib/unsaved';

type CategorySection = 'products' | 'pos' | 'units';

const SECTIONS: { id: CategorySection; label: string }[] = [
  { id: 'products', label: 'Productos' },
  { id: 'pos', label: 'TPV' },
  { id: 'units', label: 'Unidades' },
];

export function CategoriesPage() {
  const { hasPermission, user } = useAuth();
  const [section, setSection] = useState<CategorySection>('products');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  function openSection(next: CategorySection) {
    if (next === section) return;
    if (hasUnsavedChanges && !confirmDiscard()) return;
    setHasUnsavedChanges(false);
    setSection(next);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categorías"
        description="Organiza los productos y define valores que pueden heredarse al crear o configurar productos."
      />

      <nav
        aria-label="Tipos de categoría"
        className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
      >
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => openSection(item.id)}
            className={`min-h-10 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              section === item.id
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {section === 'products' && (
        <ProductCategoriesPanel
          canManage={hasPermission('product.manage')}
          canManagePricing={hasPermission('pricing.manage')}
          canManageFormula={user?.role === 'ADMIN'}
          onDirtyChange={setHasUnsavedChanges}
        />
      )}
      {section === 'pos' && (
        <PosCategoriesPanel
          canManage={hasPermission('pos_category.manage')}
          onDirtyChange={setHasUnsavedChanges}
        />
      )}
      {section === 'units' && (
        <UnitsPanel
          canManage={hasPermission('product.manage')}
          onDirtyChange={setHasUnsavedChanges}
        />
      )}
    </div>
  );
}
