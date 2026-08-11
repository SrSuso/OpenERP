import { useQuery } from '@tanstack/react-query';

import { imageUrl, imageVersionsQuery } from '@/features/images/api';
import { type PosCategory } from '@/features/pos/api';

interface CategoryTabsProps {
  categories: PosCategory[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/** Till-button tabs (phase 10). `null` means "all products" — there is no
 * dedicated backend category for it, just an unfiltered product list. */
export function CategoryTabs({ categories, selectedId, onSelect }: CategoryTabsProps) {
  const versions = useQuery(imageVersionsQuery('pos_category'));

  return (
    <div className="flex gap-2 overflow-x-auto p-3" role="tablist" aria-label="Categorías">
      <button
        type="button"
        role="tab"
        aria-selected={selectedId === null}
        onClick={() => onSelect(null)}
        className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
          selectedId === null
            ? 'bg-slate-50 text-slate-900'
            : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
        }`}
      >
        Todos
      </button>
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          role="tab"
          aria-selected={selectedId === category.id}
          onClick={() => onSelect(category.id)}
          style={selectedId === category.id ? { backgroundColor: category.color } : undefined}
          className={`flex shrink-0 items-center gap-2 rounded-full py-2 pr-4 text-sm font-medium transition ${
            versions.data?.[String(category.id)] === undefined ? 'pl-4' : 'pl-1.5'
          } ${
            selectedId === category.id
              ? 'text-white'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {versions.data?.[String(category.id)] !== undefined && (
            <img
              src={imageUrl('pos_category', category.id, versions.data[String(category.id)]!)}
              alt=""
              className="h-7 w-7 rounded-full object-cover"
            />
          )}
          {category.name}
        </button>
      ))}
    </div>
  );
}
