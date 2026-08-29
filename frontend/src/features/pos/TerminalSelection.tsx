import { usePosTerminal } from '@/features/pos/usePosTerminal';

export function TerminalSelection() {
  const {
    terminals,
    selectedTerminal,
    isLoading,
    isError,
    storedTerminalUnavailable,
    selectTerminal,
    cancelTerminalChange,
  } = usePosTerminal();

  return (
    <section className="flex h-full items-center justify-center bg-slate-900 p-6 text-slate-50">
      <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl">
        <h1 className="text-xl font-semibold">Seleccionar terminal</h1>
        <p className="mt-2 text-sm text-slate-300">
          Este navegador recordará la caja elegida. El usuario seguirá iniciando sesión con su
          propia cuenta.
        </p>

        {isLoading && <p className="mt-5 text-slate-400">Cargando terminales…</p>}
        {isError && (
          <p role="alert" className="mt-5 text-red-300">
            No se han podido cargar los terminales.
          </p>
        )}
        {storedTerminalUnavailable && (
          <p role="alert" className="mt-5 rounded bg-amber-950/60 p-3 text-sm text-amber-200">
            El terminal configurado ya no está activo. El borrador se conserva, pero no puede seguir
            operándose desde esa caja.
          </p>
        )}
        {!isLoading && !isError && terminals.length === 0 && (
          <p className="mt-5 text-slate-300">
            No hay terminales activos. Un administrador debe crear o activar uno.
          </p>
        )}

        <div className="mt-5 grid gap-2">
          {terminals.map((terminal) => (
            <button
              key={terminal.id}
              type="button"
              onClick={() => selectTerminal(terminal.id)}
              className="pos-button-secondary rounded border border-slate-600 px-4 py-3 text-left hover:border-brand-400"
            >
              <span className="block font-medium">{terminal.name}</span>
              <span className="block text-sm text-slate-300">{terminal.warehouse_name}</span>
            </button>
          ))}
        </div>

        {selectedTerminal !== null && (
          <button
            type="button"
            onClick={cancelTerminalChange}
            className="pos-button-secondary mt-5 rounded px-3 py-2 text-sm font-medium"
          >
            Mantener {selectedTerminal.name}
          </button>
        )}
      </div>
    </section>
  );
}
