import { useState } from 'react';
import { useNavigate } from 'react-router';

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
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className="mt-2 w-full rounded-lg bg-white px-4 py-3 text-lg text-slate-900"
          />
        </label>
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
