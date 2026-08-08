import { type PosCategory } from '@/features/pos/api';

interface CategoryTabsProps {
  categories: PosCategory[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

/** Till-button tabs (phase 10). `null` means "all products" — there is no
 * dedicated backend category for it, just an unfiltered product list. */
export function CategoryTabs({ categories, selectedId, onSelect }: CategoryTabsProps) {
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
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
            selectedId === category.id
              ? 'text-white'
              : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
          }`}
        >
          {category.name}
        </button>
      ))}
    </div>
  );
}
