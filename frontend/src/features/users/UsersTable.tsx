import { type Role } from '@/features/roles/api';
import { type User } from '@/features/users/api';

interface UsersTableProps {
  users: User[];
  roles: Role[];
  currentUserId: number;
  onChangeRole: (userId: number, roleId: number) => void;
  onDeactivate: (userId: number) => void;
  isChangingRole: boolean;
  isDeactivating: boolean;
}

export function UsersTable({
  users,
  roles,
  currentUserId,
  onChangeRole,
  onDeactivate,
  isChangingRole,
  isDeactivating,
}: UsersTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Usuario</th>
            <th className="px-4 py-2 font-medium">Rol</th>
            <th className="px-4 py-2 font-medium">Estado</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <tr key={user.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2">
                  <p className="font-medium text-slate-800">{user.full_name}</p>
                  <p className="text-slate-500">{user.email}</p>
                </td>
                <td className="px-4 py-2">
                  {roles.length > 0 ? (
                    <select
                      value={user.role_id}
                      disabled={!user.is_active || isChangingRole}
                      onChange={(event) => onChangeRole(user.id, Number(event.target.value))}
                      aria-label={`Rol de ${user.full_name}`}
                      className="rounded border border-slate-300 px-2 py-1 text-sm disabled:opacity-50"
                    >
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    user.role_name
                  )}
                </td>
                <td className="px-4 py-2">
                  {user.is_active ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      Activo
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      Inactivo
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {user.is_active && !isSelf && (
                    <button
                      type="button"
                      onClick={() => onDeactivate(user.id)}
                      disabled={isDeactivating}
                      className="text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Desactivar
                    </button>
                  )}
                  {isSelf && <span className="text-xs text-slate-400">(tú)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
