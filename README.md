# OpenERP

ERP web para tienda minorista, con panel de administración (`/admin`) y punto
de venta táctil (`/pos`). Es un monolito modular: FastAPI y React comparten una
base PostgreSQL; un worker independiente entrega el correo encolado.

## Versión 0.8

La versión actual es **0.8**, cierre del desarrollo de la primera versión del
producto. Las mejoras posteriores se desarrollan en ramas de v2 y se validan
antes de incorporarlas a la rama estable.

| Capa | Tecnología |
| --- | --- |
| Backend | Python 3.13+, FastAPI, SQLAlchemy async, Alembic, Pydantic, psycopg 3 |
| Base de datos | PostgreSQL 17 |
| Frontend | React 19, TypeScript, Vite, React Router, TanStack Query, Tailwind, ECharts |
| Worker | Proceso Python y outbox transaccional sobre PostgreSQL |
| Tests | pytest, Vitest/Testing Library y Playwright |

## Producto actual

La interfaz incluye:

- POS por terminal, acceso propio con usuario/PIN, varios borradores
  aparcados, buscador táctil, presentaciones/códigos de barras, cobro y
  tickets;
- productos, categorías de producto/POS, unidades, precios, impuestos,
  proveedores y compras;
- recepciones, almacenes, ubicaciones, lotes, FEFO, saldos y movimientos;
- ventas, devoluciones económicas/físicas, cierres Z e informes;
- dashboards privados, avisos, outbox y auditoría;
- usuarios, roles, permisos y configuración funcional de tienda.

Las opciones específicas de una caja (terminal, buscador táctil, pantalla,
botones, cobro e impresión automática) están en **Configuración de la tienda
→ Terminales POS**. El perfil de impresión —ancho imprimible, fuente,
márgenes laterales/verticales, textos y datos fiscales— se gestiona en
**Plantillas de ticket**, con editor estándar o plantilla segura con variables.

La documentación normativa se divide por audiencia:

| Documento | Finalidad |
| --- | --- |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | Tareas que cajeros, encargados y administradores realizan en la UI. |
| [`docs/roles/`](docs/roles/README.md) | Manuales separados para cajero, encargado y administrador. |
| [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) | Administración funcional, despliegue, upgrade, backup, restore y rollback. |
| [`docs/USAGE.md`](docs/USAGE.md) | Preparación del entorno local de desarrollo. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Diseño técnico y límites del sistema actual. |
| [`docs/TESTING.md`](docs/TESTING.md) | Política FAST/DOMAIN/FULL y comandos de pruebas. |
| [`docs/PHASES.md`](docs/PHASES.md) | Registro histórico del desarrollo; no es documentación operativa. |

## Desarrollo local

Requisitos: Python 3.13+, [uv](https://docs.astral.sh/uv/), Node.js 20.19+ y
Docker Compose o los scripts rootless incluidos.

```bash
make install
make up
cp .env.example .env
make db-create
make db-upgrade
make bootstrap-admin
```

Después, en terminales separadas:

```bash
make dev-api
make dev-web
make dev-worker    # opcional salvo para entregar correo a Mailpit
```

- Panel: <http://127.0.0.1:5173/admin>
- TPV: <http://127.0.0.1:5173/pos>
- Mailpit de desarrollo: <http://127.0.0.1:8025>

Swagger (`/api/docs`), ReDoc y OpenAPI HTTP están disponibles **sólo en
desarrollo/test**. No son herramientas de administración y están desactivados
en producción. Consulta [`docs/USAGE.md`](docs/USAGE.md) para la preparación
completa y las diferencias con producción.

## Configuración

Hay dos fuentes deliberadamente separadas:

- **Infraestructura**: `OPENERP_*` o ficheros `OPENERP_<CAMPO>_FILE`. Incluye
  base de datos, pool, CORS, cookies, sesiones, bootstrap, SMTP, rate limit y
  confianza en proxy. API, worker, Alembic y bootstrap comparten el mismo
  modelo de configuración.
- **Tienda**: PostgreSQL y la pantalla **Configuración**. Incluye nombre,
  `business.timezone`, preferencias POS, reglas comerciales y presentación.

La UI nunca lee ni escribe credenciales ni parámetros de despliegue.

## Pruebas

El ciclo habitual empieza por una prueba exacta y escala sólo cuando está
verde:

```bash
make test-fast TESTS="tests/test_sales.py::test_caso"
make test-backend-sales
make test-frontend-fast TESTS="src/features/pos/Cart.test.tsx"
make lint-frontend-fast FILES="src/features/pos/Cart.tsx"
```

Las puertas generales son:

```bash
make test        # backend + frontend
make check       # lint + test + build
make test-full   # puerta de release, incluida E2E
```

El backend usa PostgreSQL real, nunca SQLite. Consulta
[`docs/TESTING.md`](docs/TESTING.md) antes de ejecutar suites amplias o
migraciones completas.

## Producción

El stack de producción es independiente del Compose de desarrollo:

```text
cliente → Nginx :443
          ├─ /              → SPA
          ├─ /api/v1/...    → FastAPI interno
          └─ /api/* resto   → 404
```

FastAPI no publica un puerto en el host. Swagger, ReDoc, OpenAPI HTTP y health
checks de API no son públicos. PostgreSQL sólo publica en loopback para las
herramientas locales de backup/restore.

Primer despliegue:

```bash
make prod-cert host=openerp.tuempresa.local
cp .env.production.example .env.production
# Sustituye todos los valores CAMBIAR y configura los secretos fuera de Git.
make prod-build
make prod-up
make prod-bootstrap-admin
```

Las actualizaciones posteriores se realizan únicamente con:

```bash
make prod-deploy
```

Para desplegar una rama remota concreta, por ejemplo una rama de trabajo de
v2, usa `make prod-deploy branch=v2`. Esa opción cambia el checkout a la rama
indicada y despliega su último commit; consulta el procedimiento y las
precauciones de entorno separado en
[`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md#31-desplegar-una-actualización-de-código).

No improvises migraciones o restores a partir de este resumen. El procedimiento
canónico de upgrade, restore y rollback está en
[`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md).

## Estructura

```text
backend/
  app/                 módulos de dominio, API, configuración y sesiones
  migrations/          revisiones Alembic
  tests/               pruebas unitarias e integración PostgreSQL
frontend/
  src/pages/           pantallas auth, admin y POS
  src/features/        lógica de interfaz por dominio
  Dockerfile
tests/e2e/              specs Playwright
docker/
  compose.yml           PostgreSQL + Mailpit para desarrollo
  compose.prod.yml      postgres, migrate, api, worker y web
  nginx/                proxy TLS, perímetro y frontend
scripts/                desarrollo rootless y operación de producción
docs/                   guías vigentes y registro histórico
```

## Invariantes principales

1. `stock_movements` es el histórico origen del inventario;
   `stock_balance` es una proyección reconstruible.
2. El stock se almacena en unidad base; cada presentación aplica su factor.
3. Ventas, pagos y movimientos se confirman atómicamente antes del HTTP 2xx.
4. Ventas, compras, cajero, terminal, precios, impuestos y tickets conservan
   snapshots históricos cuando corresponde.
5. Dinero y cantidades usan `Decimal`/`NUMERIC(18,6)`, nunca `float`.
6. Devolución económica y devolución física son independientes.
7. SMTP nunca bloquea una venta: las peticiones sólo escriben en el outbox.
8. Los permisos se comprueban siempre en el backend.
9. Las fórmulas no usan `eval()` y dashboards/informes no aceptan SQL libre.
10. Entidades con histórico se desactivan, no se borran.
