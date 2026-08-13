# OpenERP

ERP web para tienda minorista: panel de administración (`/admin`) y punto de venta
táctil (`/pos`), construido como **monolito modular**.

| Capa | Tecnología |
| --- | --- |
| Backend | Python 3.13+, FastAPI, SQLAlchemy 2.x (async), Alembic, Pydantic v2, psycopg 3 |
| Base de datos | PostgreSQL 17 |
| Frontend | React 19, TypeScript, Vite, React Router 7, TanStack Query, React Hook Form + Zod, Tailwind CSS 4, Apache ECharts |
| Worker | Proceso Python separado, cola sobre PostgreSQL (*transactional outbox*) |
| Tests | pytest + pytest-asyncio (PostgreSQL real), Vitest + React Testing Library, Playwright |
| Desarrollo | Docker Compose (PostgreSQL + Mailpit) o scripts *rootless* equivalentes |

---

## Estado

**Las 22 fases del plan están completas** (bootstrap, auth y RBAC, auditoría,
productos, precios, proveedores, compras, inventory ledger, lotes,
recepciones, categorías POS, ventas, POS, pagos, devoluciones, tickets,
dashboards, notificaciones, SMTP/outbox, seguridad, rendimiento,
backup/restore, y el cierre: tests completos de aceptación de extremo a
extremo sobre los 21 módulos anteriores juntos). Ver
[`docs/PHASES.md`](docs/PHASES.md) para el detalle de cada fase cerrada.

**Documentación** (para instalarlo, administrarlo o usarlo — no sólo para
desarrollar sobre él):

| Documento | Para quién |
| --- | --- |
| [`docs/USAGE.md`](docs/USAGE.md) | Arranque en local para desarrollar, paso a paso. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Documentación técnica: cómo está construido el código, backend y frontend. |
| [`docs/TESTING.md`](docs/TESTING.md) | Política FAST/DOMAIN/FULL y comandos para ejecutar únicamente las pruebas relevantes. |
| [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) | Manual de administración: despliegue en la red interna, variables de entorno, backups, usuarios/roles, operación diaria. |
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | Manual de usuario: cómo usar el TPV y el panel de administración, sin tecnicismos. |

---

## Puesta en marcha

### Requisitos

- Python 3.13+ y [uv](https://docs.astral.sh/uv/)
- Node.js 20.19+ (recomendado 22)
- Docker con Compose **o**, si no hay Docker, los scripts *rootless* de `scripts/`

### 1. Infraestructura

Con Docker:

```bash
docker compose -f docker/compose.yml up -d --wait
# PostgreSQL  127.0.0.1:5432
# Mailpit     SMTP 127.0.0.1:1025 · UI http://127.0.0.1:8025
```

Sin Docker (sin permisos de administrador; descarga los binarios en `~/.local`):

```bash
./scripts/dev-postgres.sh start   # PostgreSQL 17 en 127.0.0.1:55432
./scripts/dev-mailpit.sh start    # Mailpit en 1025 / 8025
source scripts/env.sh             # PATH + OPENERP_DATABASE_URL
```

### 2. Dependencias y base de datos

```bash
cp .env.example .env              # ajusta OPENERP_DATABASE_URL al puerto que uses

cd backend  && uv sync     && cd ..   # dependencias del backend
cd frontend && npm install && cd ..   # dependencias del frontend
npm install                           # suite E2E (Playwright)

cd backend && uv run alembic upgrade head && cd ..
```

No hay registro público: crea el primer administrador con
`make bootstrap-admin` (interactivo) antes de iniciar sesión — detalle en
[`docs/USAGE.md`](docs/USAGE.md). Para ver el TPV (`/pos`) con productos de
ejemplo en vez de una rejilla vacía: `make seed-e2e-catalog` (idempotente).

### 3. Arrancar

```bash
# terminal 1
cd backend && uv run uvicorn app.main:app --reload --port 8000

# terminal 2
cd frontend && npm run dev

# terminal 3 (opcional): envía los correos que encola la fase 17
# (incidentes de notificaciones) — sin él, se quedan en PENDING en outbox_messages.
make dev-worker
```

- Panel: <http://127.0.0.1:5173/admin>
- TPV: <http://127.0.0.1:5173/pos>
- OpenAPI: <http://127.0.0.1:8000/api/docs>
- Mailpit (correo de desarrollo): <http://127.0.0.1:8025>

El `Makefile` de la raíz agrupa todo lo anterior (`make help`).

### Configuración

La infraestructura (`database_url`, pool, CORS, cookie/sesiones, bootstrap,
SMTP y rate limit) procede exclusivamente de `OPENERP_*` o de un fichero
montado indicado por `OPENERP_<CAMPO>_FILE`. La variante `_FILE` tiene
precedencia sobre la variable directa y sirve para Docker secrets sin añadir
un gestor de secretos. API, worker, Alembic y bootstrap comparten el mismo
modelo; un cambio requiere reiniciar los procesos afectados.

La configuración funcional de la tienda —incluida `business.timezone`— sí se
guarda en PostgreSQL y se edita desde **Configuración**. El panel nunca lee ni
modifica credenciales o parámetros de despliegue. Consulta las variables en
[`.env.example`](.env.example) y el despliegue en
[`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md).

---

## Tests

```bash
cd backend  && uv run pytest     # pytest sobre PostgreSQL real
cd frontend && npm run test      # Vitest + React Testing Library
npm run test:e2e                 # Playwright, desde la raíz (levanta API + frontend)
```

La primera vez, instala el navegador:

```bash
npx playwright install --with-deps chromium
# sin permisos de administrador:
npx playwright install chromium && ./scripts/dev-browsers.sh install && source scripts/env.sh
```

El backend **nunca** usa SQLite. `pytest` resuelve el servidor así:

1. `OPENERP_TEST_DATABASE_URL` si está definida (Compose, CI o script *rootless*).
2. Testcontainers, si hay un demonio Docker operativo.
3. En otro caso falla con instrucciones. No degrada silenciosamente.

Cada sesión crea una base de datos desechable y la migra con el `alembic upgrade
head` real, de modo que la cadena de migraciones se ejercita en cada ejecución.
Para el ciclo rápido, selección por dominio y puertas completas, consulta
[`docs/TESTING.md`](docs/TESTING.md).

---

## Copias de seguridad

```bash
make db-backup
make db-restore f=backups/openerp_....dump target=openerp_restore_prueba
```

Copia lógica custom verificada con `pg_restore --list`, SHA-256 y metadata. El
restore nunca limpia la base configurada: exige un nombre nuevo, crea esa base
y valida revisión/tablas/datos. `backend/tests/test_backup_restore.py` prueba el
recorrido real con PostgreSQL. El procedimiento de producción y rollback está
centralizado en [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md#4-backup-restore-y-rollback).

---

## Despliegue en la red interna

Lo anterior es para desarrollar en tu máquina. Para publicar OpenERP en un
servidor de la red interna de la empresa (no sólo en `localhost`) hay un
stack de Docker Compose de producción independiente — imágenes propias del
backend/frontend, HTTPS con certificado interno y las tres piezas
(API, worker, frontend) como servicios separados:

```bash
make prod-cert host=openerp.tuempresa.local   # certificado TLS interno
cp .env.production.example .env.production    # y edítalo (contraseñas, dominio)
make prod-build
make prod-up
make prod-bootstrap-admin
```

Guía completa, con qué es cada pieza y cómo operarlo, en
[`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md).

---

## Estructura

```
backend/
  app/
    api/            # routers HTTP, middleware
    core/           # settings, logging estructurado, errores, contexto de petición
    db/             # Base declarativa, tipos NUMERIC(18,6), sesiones async
    auth/ users/ rbac/ catalog/ pricing/ suppliers/ purchasing/
    inventory/ lots/ sales/ returns/ dashboards/ notifications/
    tickets/ audit/ jobs/
    main.py
  migrations/       # Alembic
  scripts/          # utilidades de desarrollo (devdb)
  tests/
  Dockerfile        # imagen de producción (api/worker/migrate)
frontend/
  src/              # features/, pages/admin, pages/pos, lib/
  tests/
  Dockerfile        # imagen de producción (build + nginx)
tests/e2e/          # Playwright: config + specs (proyecto npm de la raíz)
docker/
  compose.yml       # infraestructura de desarrollo: PostgreSQL + Mailpit
  compose.prod.yml  # stack de producción: postgres, migrate, api, worker, web
  nginx/nginx.conf  # reverse proxy + TLS + estáticos del `web` de producción
deploy/certs/       # certificado TLS interno (generado, no versionado)
scripts/            # alternativas rootless a Docker, backup/restore, gen-internal-cert.sh
docs/               # ARCHITECTURE.md, ADMIN_GUIDE.md, USER_GUIDE.md, USAGE.md, PHASES.md
```

Hay tres proyectos npm: `frontend/` (la aplicación), la raíz (sólo la suite E2E,
separada para que las specs de `tests/e2e/` resuelvan Playwright y para que una
actualización de Playwright no toque el árbol de dependencias de la app) y
ninguno más.

---

## Reglas de arquitectura

Invariantes que no se rompen; cada fase añade tests que las protegen.

1. `stock_movements` es el origen histórico del inventario.
2. `stock_balance` es sólo una proyección optimizada, reconstruible.
3. Todo el stock se almacena en la unidad base del producto.
4. Las presentaciones (cajas) se convierten mediante un factor.
5. Venta, pagos y movimientos de inventario son atómicos.
6. Ventas y compras guardan *snapshots* históricos de precios e impuestos.
7. Cambiar precios actuales nunca modifica ventas anteriores.
8. Dinero y cantidades usan `Decimal`/`NUMERIC(18,6)`, nunca `float`.
9. Devolución económica y devolución física son conceptos independientes.
10. SMTP nunca bloquea una venta.
11. Los permisos siempre se comprueban en el backend.
12. Las fórmulas de precio nunca usan `eval()`.
13. Los dashboards nunca ejecutan SQL arbitrario.
14. Productos, proveedores y usuarios con histórico se desactivan, no se borran.
15. Cada fase queda funcionando y probada antes de continuar.
