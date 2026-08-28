import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { Alert, Button, Card, EmptyState, FormField, Input } from '@/components/ui';
import {
  activateProductCategory,
  createProductCategory,
  deactivateProductCategory,
  deleteProductCategory,
  productCategoriesQuery,
  unitsQuery,
  updateProductCategory,
  type ProductCategory,
} from '@/features/catalog/api';
import { setCategoryPricing, taxesQuery, type Tax } from '@/features/pricing/api';
import { TaxChips } from '@/features/pricing/TaxChips';
import { ApiError } from '@/lib/api';
import { confirmDiscard, useUnsavedWarning } from '@/lib/unsaved';

interface CategoryValues {
  name: string;
  tracksStock: boolean;
  isSoldByWeight: boolean;
  quickPriceEdit: boolean;
  defaultUnitName: string;
  margin: string;
  amount: string;
  formula: string;
  taxIds: Set<number>;
}

const EMPTY_VALUES: CategoryValues = {
  name: '',
  tracksStock: true,
  isSoldByWeight: false,
  quickPriceEdit: false,
  defaultUnitName: '',
  margin: '',
  amount: '',
  formula: '',
  taxIds: new Set(),
};

function valuesFor(category: ProductCategory): CategoryValues {
  return {
    name: category.name,
    tracksStock: category.tracks_stock,
    isSoldByWeight: category.is_sold_by_weight ?? false,
    quickPriceEdit: category.quick_price_edit ?? false,
    defaultUnitName: category.default_unit_name ?? '',
    margin: category.margin_rate ?? '',
    amount: category.margin_amount ?? '',
    formula: category.price_formula ?? '',
    taxIds: new Set(category.taxes.map((tax) => tax.id)),
  };
}

function sameValues(left: CategoryValues, right: CategoryValues): boolean {
  return (
    left.name === right.name &&
    left.tracksStock === right.tracksStock &&
    left.isSoldByWeight === right.isSoldByWeight &&
    left.quickPriceEdit === right.quickPriceEdit &&
    left.defaultUnitName === right.defaultUnitName &&
    left.margin === right.margin &&
    left.amount === right.amount &&
    left.formula === right.formula &&
    left.taxIds.size === right.taxIds.size &&
    [...left.taxIds].every((id) => right.taxIds.has(id))
  );
}

export function ProductCategoriesPanel({
  canManage,
  canManagePricing,
  canManageFormula,
  onDirtyChange,
}: {
  canManage: boolean;
  canManagePricing: boolean;
  canManageFormula: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const categories = useQuery(productCategoriesQuery);
  const units = useQuery(unitsQuery);
  const taxes = useQuery({ ...taxesQuery, enabled: canManagePricing });
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDirtyChange?.(editorDirty);
    return () => onDirtyChange?.(false);
  }, [editorDirty, onDirtyChange]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: productCategoriesQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'products'] });
  };

  function closeEditor() {
    setEditingId(null);
    setEditorDirty(false);
    setError(null);
  }

  function openEditor(next: number | 'new') {
    if (editorDirty && !confirmDiscard()) return;
    setEditingId(next);
    setEditorDirty(false);
    setError(null);
  }

  const saveMutation = useMutation({
    mutationFn: async ({
      category,
      values,
    }: {
      category: ProductCategory | null;
      values: CategoryValues;
    }) => {
      const pricing = {
        margin_rate: values.margin.trim() === '' ? null : values.margin,
        margin_amount: values.amount.trim() === '' ? null : values.amount,
        tax_ids: [...values.taxIds],
        ...(canManageFormula ? { price_formula: values.formula.trim() } : {}),
      };
      if (category === null) {
        return createProductCategory({
          name: values.name.trim(),
          tracks_stock: values.tracksStock,
          is_sold_by_weight: values.isSoldByWeight,
          quick_price_edit: values.quickPriceEdit,
          default_unit_name: values.defaultUnitName || null,
          margin_rate: canManagePricing ? pricing.margin_rate : null,
          margin_amount: canManagePricing ? pricing.margin_amount : null,
          price_formula:
            canManagePricing && 'price_formula' in pricing && pricing.price_formula
              ? pricing.price_formula
              : null,
          tax_ids: canManagePricing ? pricing.tax_ids : [],
        });
      }

      const original = valuesFor(category);
      const baseChanged =
        values.name.trim() !== category.name ||
        values.tracksStock !== category.tracks_stock ||
        values.isSoldByWeight !== (category.is_sold_by_weight ?? false) ||
        values.quickPriceEdit !== (category.quick_price_edit ?? false) ||
        values.defaultUnitName !== (category.default_unit_name ?? '');
      if (baseChanged) {
        await updateProductCategory(category.id, {
          name: values.name.trim(),
          tracks_stock: values.tracksStock,
          is_sold_by_weight: values.isSoldByWeight,
          quick_price_edit: values.quickPriceEdit,
          default_unit_name: values.defaultUnitName || null,
        });
      }
      const pricingChanged =
        values.margin !== original.margin ||
        values.amount !== original.amount ||
        (canManageFormula && values.formula !== original.formula) ||
        values.taxIds.size !== original.taxIds.size ||
        [...values.taxIds].some((id) => !original.taxIds.has(id));
      if (canManagePricing && pricingChanged) {
        await setCategoryPricing(category.id, pricing);
      }
      return category;
    },
    onSuccess: () => {
      invalidate();
      closeEditor();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? 'Ya existe una categoría con ese nombre.'
          : 'No se ha podido guardar la categoría.',
      ),
  });

  const activeMutation = useMutation({
    mutationFn: (category: ProductCategory) =>
      category.is_active
        ? deactivateProductCategory(category.id)
        : activateProductCategory(category.id),
    onSuccess: () => {
      invalidate();
      closeEditor();
    },
    onError: () => setError('No se ha podido cambiar el estado de la categoría.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: ProductCategory) => deleteProductCategory(category.id),
    onSuccess: () => {
      invalidate();
      closeEditor();
    },
    onError: (err: unknown) =>
      setError(
        err instanceof ApiError && err.code === 'conflict'
          ? err.message
          : 'No se ha podido borrar la categoría.',
      ),
  });

  const selectedCategory =
    typeof editingId === 'number'
      ? ((categories.data ?? []).find((category) => category.id === editingId) ?? null)
      : null;
  const busy = saveMutation.isPending || activeMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Categorías de producto</h2>
            <p className="mt-1 text-sm text-slate-600">
              Agrupan el inventario y definen valores que pueden heredar sus productos.
            </p>
          </div>
          {canManage && editingId !== 'new' && (
            <Button onClick={() => openEditor('new')}>+ Nueva categoría</Button>
          )}
        </div>

        {categories.isPending && <p className="p-5 text-sm text-slate-500">Cargando…</p>}
        {categories.isError && (
          <div className="p-5">
            <Alert tone="error">No se han podido cargar las categorías.</Alert>
          </div>
        )}
        {categories.isSuccess && categories.data.length === 0 && (
          <div className="p-5">
            <EmptyState
              title="Todavía no hay categorías de producto"
              description="Crea una para organizar el catálogo y definir su comportamiento habitual."
              action={
                canManage ? (
                  <Button onClick={() => openEditor('new')}>+ Nueva categoría</Button>
                ) : undefined
              }
            />
          </div>
        )}
        {categories.data && categories.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">Nombre</th>
                  <th className="px-5 py-3">Comportamiento</th>
                  <th className="px-5 py-3">Estado</th>
                  {canManage && <th className="px-5 py-3 text-right">Acción</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.data.map((category) => (
                  <tr key={category.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-semibold text-slate-900">{category.name}</td>
                    <td className="px-5 py-4 text-slate-600">
                      {categoryBehaviour(category).join(' · ')}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          category.is_active
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {category.is_active ? 'Activa' : 'Oculta'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-5 py-4 text-right">
                        <Button
                          variant="ghost"
                          className="min-h-8 px-3 py-1"
                          aria-label={`Editar «${category.name}»`}
                          onClick={() => openEditor(category.id)}
                        >
                          Editar
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {(editingId === 'new' || selectedCategory !== null) && (
        <CategoryForm
          key={editingId}
          category={selectedCategory}
          units={units.data ?? []}
          taxes={taxes.data ?? []}
          canManagePricing={canManagePricing}
          canManageFormula={canManageFormula}
          isPending={busy}
          error={error}
          onDirtyChange={setEditorDirty}
          onCancel={() => {
            if (!editorDirty || confirmDiscard()) closeEditor();
          }}
          onSubmit={(values) => saveMutation.mutate({ category: selectedCategory, values })}
          onToggleActive={
            selectedCategory
              ? () => {
                  const question = selectedCategory.is_active
                    ? `¿Ocultar «${selectedCategory.name}»?\n\nYa no podrá elegirse en productos nuevos, pero los productos actuales la conservarán.`
                    : `¿Volver a mostrar «${selectedCategory.name}»?`;
                  if (window.confirm(question)) activeMutation.mutate(selectedCategory);
                }
              : undefined
          }
          onDelete={
            selectedCategory
              ? () => {
                  if (
                    window.confirm(
                      `¿Borrar «${selectedCategory.name}» definitivamente?\n\nEsto no se puede deshacer. Si quieres conservarla, utiliza Ocultar.`,
                    )
                  ) {
                    deleteMutation.mutate(selectedCategory);
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function categoryBehaviour(category: ProductCategory): string[] {
  const labels = [category.tracks_stock ? 'Control de stock' : 'Sin control de stock'];
  if (category.is_sold_by_weight) labels.push('Por peso');
  if (category.quick_price_edit) labels.push('PVP rápido');
  return labels;
}

function CategoryForm({
  category,
  units,
  taxes,
  canManagePricing,
  canManageFormula,
  isPending,
  error,
  onDirtyChange,
  onCancel,
  onSubmit,
  onToggleActive,
  onDelete,
}: {
  category: ProductCategory | null;
  units: { id: number; name: string }[];
  taxes: Tax[];
  canManagePricing: boolean;
  canManageFormula: boolean;
  isPending: boolean;
  error: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (values: CategoryValues) => void;
  onToggleActive?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
}) {
  const initial = category ? valuesFor(category) : EMPTY_VALUES;
  const [values, setValues] = useState<CategoryValues>(() => ({
    ...initial,
    taxIds: new Set(initial.taxIds),
  }));
  const formulaId = useId();
  const nameId = useId();
  const unitId = useId();
  const marginId = useId();
  const amountId = useId();
  const dirty = !sameValues(values, initial);
  useUnsavedWarning(dirty);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.name.trim()) return;
    onSubmit(values);
  }

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={submit} className="space-y-7">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {category ? `Editar ${category.name}` : 'Nueva categoría de producto'}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Configura sus valores habituales. Después podrás hacer excepciones en cada producto.
          </p>
        </div>

        {error && <Alert tone="error">{error}</Alert>}

        <fieldset className="space-y-4">
          <legend className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Información
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Nombre" htmlFor={nameId}>
              <Input
                id={nameId}
                autoFocus
                value={values.name}
                onChange={(event) => setValues({ ...values, name: event.target.value })}
              />
            </FormField>
            <FormField
              label="Unidad por defecto"
              htmlFor={unitId}
              hint="Se propone al crear productos; cada producto puede usar otra."
            >
              <select
                id={unitId}
                value={values.defaultUnitName}
                onChange={(event) => setValues({ ...values, defaultUnitName: event.target.value })}
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Sin unidad por defecto</option>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.name}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Inventario y venta
          </legend>
          <CheckOption
            checked={values.tracksStock}
            onChange={(checked) => setValues({ ...values, tracksStock: checked })}
            label="Llevar control de existencias"
            description="Los productos de esta categoría descontarán stock por defecto."
          />
          <CheckOption
            checked={values.isSoldByWeight}
            onChange={(checked) => setValues({ ...values, isSoldByWeight: checked })}
            label="Vender al peso en el TPV"
            description="El TPV pedirá el peso al añadir estos productos."
          />
          <CheckOption
            checked={values.quickPriceEdit}
            onChange={(checked) => setValues({ ...values, quickPriceEdit: checked })}
            label="Permitir cambiar el PVP desde Productos"
            description="Útil para fruta, verdura y otros artículos cuyo precio cambia con frecuencia."
          />
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Precio por defecto
          </legend>
          {!canManagePricing && (
            <Alert>
              Puedes consultar estos valores, pero necesitas permiso de precios para modificarlos.
            </Alert>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Margen porcentual (%)" htmlFor={marginId}>
              <Input
                id={marginId}
                inputMode="decimal"
                disabled={!canManagePricing}
                value={values.margin}
                placeholder="Sin margen por defecto"
                onChange={(event) => setValues({ ...values, margin: event.target.value })}
              />
            </FormField>
            <FormField label="Margen fijo (€)" htmlFor={amountId}>
              <Input
                id={amountId}
                inputMode="decimal"
                disabled={!canManagePricing}
                value={values.amount}
                placeholder="Por ejemplo, 0,25"
                onChange={(event) => setValues({ ...values, amount: event.target.value })}
              />
            </FormField>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-700">Impuestos</p>
            <div className={`mt-2 ${canManagePricing ? '' : 'pointer-events-none opacity-60'}`}>
              <TaxChips
                taxes={taxes}
                selected={values.taxIds}
                onChange={(taxIds) => setValues({ ...values, taxIds })}
              />
            </div>
          </div>
        </fieldset>

        {canManageFormula && (
          <details className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-800">
              Configuración avanzada
            </summary>
            <p className="mt-3 text-sm text-slate-700">
              Modificar esta fórmula cambia cómo se calculan los precios de los productos de esta
              categoría.
            </p>
            <div className="mt-4">
              <FormField
                label="Fórmula personalizada"
                htmlFor={formulaId}
                hint="Déjala vacía para utilizar la fórmula general de la tienda."
              >
                <Input
                  id={formulaId}
                  disabled={!canManagePricing}
                  value={values.formula}
                  className="font-mono"
                  onChange={(event) => setValues({ ...values, formula: event.target.value })}
                />
              </FormField>
            </div>
          </details>
        )}

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-5">
          <Button type="submit" disabled={isPending || !values.name.trim() || !dirty}>
            {isPending ? 'Guardando…' : category ? 'Guardar cambios' : 'Crear categoría'}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
        </div>

        {category && (onToggleActive || onDelete) && (
          <details className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              Acciones avanzadas
            </summary>
            <p className="mt-2 text-sm text-slate-600">
              Ocultar es reversible. Borrar sólo es posible si ningún producto utiliza la categoría.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onToggleActive && (
                <Button variant="secondary" onClick={onToggleActive} disabled={isPending}>
                  {category.is_active ? 'Ocultar categoría' : 'Mostrar categoría'}
                </Button>
              )}
              {onDelete && (
                <Button variant="danger" onClick={onDelete} disabled={isPending}>
                  Borrar definitivamente
                </Button>
              )}
            </div>
          </details>
        )}
      </form>
    </Card>
  );
}

function CheckOption({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 hover:bg-slate-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        <span className="mt-1 block text-sm text-slate-500">{description}</span>
      </span>
    </label>
  );
}
