# Plan de fases

Orden estricto. Una fase no empieza si la anterior está rota. Al cerrar cada
fase se entrega: qué se implementó, archivos tocados, migraciones, endpoints,
tests añadidos, comandos ejecutados, resultado real de los tests, deuda técnica
y commit.

| # | Fase | Estado |
| --- | --- | --- |
| 0 | Bootstrap del proyecto | ✅ completada |
| 1 | Auth y RBAC | ✅ completada |
| 2 | Auditoría | pendiente |
| 3 | Productos | pendiente |
| 4 | Precios | pendiente |
| 5 | Proveedores | pendiente |
| 6 | Compras | pendiente |
| 7 | Inventory ledger | pendiente |
| 8 | Lotes y caducidad | pendiente |
| 9 | Recepciones | pendiente |
| 10 | Categorías POS | pendiente |
| 11 | Ventas | pendiente |
| 12 | POS | pendiente |
| 13 | Pagos | pendiente |
| 14 | Devoluciones | pendiente |
| 15 | Tickets | pendiente |
| 16 | Dashboards | pendiente |
| 17 | Notificaciones | pendiente |
| 18 | SMTP / outbox | pendiente |
| 19 | Seguridad | pendiente |
| 20 | Rendimiento | pendiente |
| 21 | Backup / restore | pendiente |
| 22 | Tests completos de aceptación | pendiente |

---

## Fase 0 — Bootstrap

**Objetivo:** que exista un esqueleto ejecutable, migrable y probado, con las
decisiones estructurales ya fijadas, para que las fases siguientes sólo añadan
dominio.

Entregado:

- Monolito modular con un paquete por módulo de dominio (vacíos, documentados
  con la fase en la que se llenan).
- Configuración por entorno (`pydantic-settings`, prefijo `OPENERP_`).
- Logging estructurado JSON con `request_id` propagado por *contextvars*.
- Sobre de error único para toda la API, con `request_id` incluido.
- Motor async de SQLAlchemy, una transacción por petición.
- **Tipos `NUMERIC(18,6)` / `Decimal`** como única forma de declarar dinero y
  cantidades (regla 8), con tests contra PostgreSQL real.
- Alembic con convención de nombres de constraints y revisión ancla.
- Arnés de tests sobre PostgreSQL real, con base de datos desechable por sesión
  y aislamiento por transacción; fixture aparte para tests de concurrencia que
  necesitan *commits* reales (fases 11 y 14).
- Frontend con dos superficies independientes (`/admin`, `/pos`), cliente HTTP
  tipado que valida cada respuesta con Zod.
- Playwright con proyectos separados para panel y TPV (éste con `hasTouch`).
- CI: lint, tipos, migraciones (aplicar, revertir, `alembic check`), tests de
  integración, build del frontend y E2E.

### Decisiones que condicionan fases posteriores

- **Una transacción por petición.** `get_session` hace *commit* al terminar el
  handler y *rollback* ante cualquier excepción, así el checkout de la fase 11
  es atómico sin que cada servicio gestione su transacción.
- **`app/db/registry.py`** es el único punto de importación de modelos: si un
  modelo no está ahí, Alembic no lo ve. El test `alembic check` falla si se
  olvida.
- **Los permisos no viven en el frontend.** Las rutas de React se ocultan por
  comodidad; la comprobación real es de la fase 1 y siempre en el backend.
- **`request_id` y `user_id` en *contextvars*** para que la auditoría de la
  fase 2 no tenga que propagarlos por cada firma.

## Fase 1 — Auth y RBAC

**Objetivo:** login/logout con sesiones revocables y autorización por
permisos comprobada siempre en el backend (regla 11), con `/admin` y `/pos`
protegidas en el frontend por comodidad — el backend rechaza igual.

Entregado:

- **Sesión server-side vía cookie httpOnly** (`openerp_session`), no JWT: el
  frontend ya mandaba `credentials: 'include'` y el CORS ya tenía
  `allow_credentials=True` desde la fase 0, así que la cookie era la opción
  coherente con lo ya construido. Expiración deslizante (30 días por
  defecto, `OPENERP_SESSION_TTL_DAYS`), con la escritura de
  `last_seen_at`/`expires_at` limitada a una vez por minuto
  (`OPENERP_SESSION_TOUCH_INTERVAL_SECONDS`) para no convertir cada petición
  en un `UPDATE`. Sólo el hash SHA-256 del token viaja a la base de datos
  (`auth_sessions.token_hash`); el valor crudo únicamente existe en la
  cookie del cliente.
- **Contraseñas con Argon2id** (`argon2-cffi`).
- **RBAC dinámico en base de datos**: `roles`, `permissions`,
  `role_permissions` (M:N). Los permisos se comprueban por clave estable
  (`"users.manage"`, nunca por nombre de rol) vía
  `app.rbac.dependencies.require_permission`, la dependencia que **todas**
  las fases futuras deben usar para proteger sus routers. Catálogo de
  permisos centralizado en `app.rbac.permissions` — cada fase añade los
  suyos ahí, sin tocar el resto.
- **Roles sembrados por la migración** (dato de referencia, no secreto):
  `ADMIN` (los 4 permisos), `MANAGER` (`admin.access`, `users.manage`),
  `CASHIER` (`pos.access`). Editables después vía `POST /roles` /
  `PATCH /roles/{id}/permissions` sin desplegar código.
- **Usuarios**: alta/edición/desactivación (regla 14: nunca se borran),
  email normalizado a minúsculas con índice único funcional
  (`lower(email)`), cambio de la propia contraseña.
- **Primer admin vía CLI** (`app.auth.bootstrap`, `make bootstrap-admin`),
  interactivo o por `OPENERP_BOOTSTRAP_ADMIN_EMAIL`/`_PASSWORD`. Idempotente
  y no deja ninguna contraseña en migraciones ni en el repo.
- **Endpoints**: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
  `GET /auth/sessions`, `DELETE /auth/sessions/{id}` · `GET|POST /users`,
  `GET|PATCH /users/{id}`, `POST /users/{id}/deactivate`,
  `POST /users/me/password` · `GET /roles`, `POST /roles`,
  `PATCH /roles/{id}/permissions`, `GET /permissions`.
- **Frontend**: `/login`, `AuthProvider`/`useAuth` (hidrata `GET /auth/me`
  vía TanStack Query), guards `RequireAuth`/`RequirePermission` en
  `routes.tsx`, botón de salir en ambos *layouts*.
- **Tests backend** (pytest, PostgreSQL real): hashing, login (credenciales
  correctas/incorrectas, email case-insensitive, usuario desactivado, cookie
  `HttpOnly`), sesión (`/auth/me`, logout revoca, cookie inválida, listar y
  revocar sesiones), autorización (admin con todos los permisos, cajero sólo
  `pos.access`, cajero → 403 en `/users`, manager sin `roles.manage`,
  401 vs 403), usuarios (alta, email duplicado → 409, desactivar bloquea
  login, cambio de contraseña propia), roles (listar, crear, conceder
  permisos, clave desconocida → 422, nombre duplicado → 409).

Archivos añadidos/tocados: `backend/app/{auth,users,rbac}/*`,
`backend/app/db/registry.py`, `backend/app/api/v1/router.py`,
`backend/app/core/config.py`, `backend/pyproject.toml`, `.env.example`,
`Makefile`, `backend/migrations/versions/…_phase_1_auth_and_rbac.py`,
`backend/tests/{conftest,test_auth_*,test_users_router,test_rbac_*}.py`,
`frontend/src/features/auth/*`, `frontend/src/pages/auth/LoginPage.tsx`,
`frontend/src/{App,routes}.tsx`, `frontend/src/pages/{admin,pos}/*Layout.tsx`.

Comandos ejecutados y resultado real: ver [`docs/USAGE.md`](USAGE.md) para
cómo arrancar el entorno, y el informe de cierre de fase en el historial de
la conversación para la salida exacta de `pytest`/`ruff`/`mypy` (69 tests,
0 fallos).

Deuda técnica conocida:

- El frontend (`AuthProvider`, `LoginPage`, guards) no se ha podido verificar
  con `npm run typecheck` / `vitest` / Playwright en este entorno porque no
  hay Node.js instalado — sí se han seguido al detalle los patrones ya
  probados en `frontend/src/features/health` y `frontend/src/lib/api.ts`.
  Ejecutar `make install-frontend && make lint-frontend && make test-frontend`
  antes de dar la fase por cerrada en un entorno con Node.
- No hay pantallas de administración de usuarios/roles en `/admin` todavía
  (la API está completa y documentada en `/api/docs`); se añaden cuando una
  fase posterior las necesite, para no construir UI sin caso de uso ni test
  E2E que la ejercite.
- `auth_sessions` no tiene todavía un job de limpieza de filas expiradas
  (no afecta a la corrección, sólo crecimiento de tabla); candidato natural
  para `app/jobs` cuando esa fase llegue.
