import { useMemo, useState } from 'react';

import { type Permission, type Role } from '@/features/roles/api';

interface RoleCardProps {
  role: Role;
  permissions: Permission[];
  onSave: (permissionKeys: string[]) => void;
  isSaving: boolean;
}

/** A role's permission set, editable in place: check/uncheck from the full
 * catalogue, "Guardar cambios" only appears once it actually differs from
 * what the role has now (`PATCH .../permissions` replaces the whole set,
 * see backend/app/rbac/service.py — there is no partial add/remove). */
export function RoleCard({ role, permissions, onSave, isSaving }: RoleCardProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role.permissions));

  const isDirty = useMemo(() => {
    const original = new Set(role.permissions);
    return selected.size !== original.size || [...selected].some((key) => !original.has(key));
  }, [selected, role.permissions]);

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-800">{role.name}</h3>
        {role.description && <p className="text-sm text-slate-500">{role.description}</p>}
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {permissions.map((permission) => (
          <label
            key={permission.key}
            className="flex items-start gap-2 text-sm text-slate-600"
            title={permission.description}
          >
            <input
              type="checkbox"
              checked={selected.has(permission.key)}
              onChange={() => toggle(permission.key)}
              className="mt-0.5"
            />
            <span>{permission.key}</span>
          </label>
        ))}
      </div>

      {isDirty && (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSave([...selected])}
            disabled={isSaving}
            className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSaving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set(role.permissions))}
            disabled={isSaving}
            className="rounded px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Deshacer
          </button>
        </div>
      )}
    </div>
  );
}
