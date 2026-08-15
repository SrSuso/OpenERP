import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { posLoginUsersQuery } from '@/features/auth/api';
import { usePosAuth } from '@/features/auth/usePosAuth';
import { ApiError } from '@/lib/api';

const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '←', '0', 'Borrar'];

export function PosLoginPage() {
  const { login } = usePosAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const loginUsers = useQuery({ ...posLoginUsersQuery, retry: false });

  const press = (key: string) => {
    if (key === '←') return setPin((value) => value.slice(0, -1));
    if (key === 'Borrar') return setPin('');
    if (pin.length < 12) setPin((value) => value + key);
  };
  const submit = async () => {
    if (!username.trim() || pin.length < 4) return;
    setPending(true);
    setError(null);
    try {
      await login(username.trim(), pin);
      void navigate('/pos', { replace: true });
    } catch (cause) {
      setPin('');
      setError(
        cause instanceof ApiError && cause.isUnauthenticated
          ? 'Usuario o PIN incorrectos.'
          : 'No se ha podido entrar.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-slate-900 p-6 text-slate-50">
      <section className="w-full max-w-sm rounded-2xl bg-slate-800 p-6 shadow-xl">
        <h1 className="text-center text-2xl font-semibold">Acceso TPV</h1>
        <label className="mt-6 block text-sm font-medium">
          Usuario
          <select
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="mt-2 w-full rounded-lg bg-white px-4 py-3 text-lg text-slate-900"
            disabled={loginUsers.isPending || loginUsers.isError || pending}
          >
            <option value="">
              {loginUsers.isPending ? 'Cargando usuarios…' : 'Selecciona tu usuario'}
            </option>
            {(loginUsers.data ?? []).map((user) => (
              <option key={user.id} value={user.username}>
                {user.full_name}
              </option>
            ))}
          </select>
        </label>
        {loginUsers.isError && (
          <p className="mt-2 text-sm text-red-300">No se han podido cargar los usuarios TPV.</p>
        )}
        {!loginUsers.isPending && !loginUsers.isError && loginUsers.data?.length === 0 && (
          <p className="mt-2 text-sm text-slate-300">
            No hay usuarios TPV habilitados. Pídelo a Administración.
          </p>
        )}
        <div
          className="mt-5 rounded-lg bg-slate-950 px-4 py-3 text-center text-2xl tracking-[0.5em]"
          aria-label="PIN"
        >
          {'•'.repeat(pin.length)}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {keys.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => press(key)}
              className="min-h-14 rounded-lg bg-slate-700 text-xl font-medium hover:bg-slate-600"
            >
              {key}
            </button>
          ))}
        </div>
        {error && <p className="mt-4 text-center text-sm text-red-300">{error}</p>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || !username.trim() || pin.length < 4}
          className="mt-5 w-full rounded-lg bg-brand-600 py-3 text-lg font-semibold disabled:opacity-50"
        >
          {pending ? 'Entrando…' : 'Entrar'}
        </button>
      </section>
    </main>
  );
}
