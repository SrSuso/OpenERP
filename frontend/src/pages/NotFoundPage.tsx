import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <Link to="/admin" className="text-brand-600 underline">
        Volver al panel
      </Link>
    </section>
  );
}
