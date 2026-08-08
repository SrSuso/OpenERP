# Plan de fases

Orden estricto. Una fase no empieza si la anterior está rota. Al cerrar cada
fase se entrega: qué se implementó, archivos tocados, migraciones, endpoints,
tests añadidos, comandos ejecutados, resultado real de los tests, deuda técnica
y commit.

| # | Fase | Estado |
| --- | --- | --- |
| 0 | Bootstrap del proyecto | ✅ completada |
| 1 | Auth y RBAC | ✅ completada |
| 2 | Auditoría | ✅ completada |
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
la conversación para la salida exacta de cada comando.

**Backend**: `ruff check`/`ruff format --check`/`mypy` limpios, `pytest -q`
→ 69 tests, 0 fallos, contra PostgreSQL real.

**Frontend** (Node.js 22.22.1 instalado tras la primera entrega, que se hizo
sin Node disponible): `tsc --build`, `eslint` (0 errores, 1 aviso aceptado:
co-ubicar `AuthProvider` y `useAuth` en un archivo — patrón habitual),
`prettier --check` y `vite build` limpios; `vitest` → 13/13. Verificar con
Node real, no sólo revisar el código, encontró y corrigió dos fallos reales
que la revisión estática no vio:
  1. `queryClient.setQueryData(meQuery.queryKey, null)` no compilaba: la
     `queryKey` de `meQuery` va tipada por `Me` vía `queryOptions`, y `null`
     no encajaba. Arreglado tratando "sin sesión" como dato legítimo — el
     propio `queryFn` de `meQuery` resuelve un 401 a `null` en vez de
     lanzarlo, así que la caché puede representarlo sin pelearse con el
     sistema de tipos.
  2. Bucle infinito de redirección: un cajero sin `admin.access` en
     `/admin` rebotaba a `/`, y `/` redirigía siempre a `/admin` sin mirar
     permisos → bucle. Arreglado con `HomeRedirect`
     (`frontend/src/features/auth/guards.tsx`), que resuelve `/` según los
     permisos reales del usuario.
  3. (Detectado sólo en E2E, no en Vitest) el botón «Salir» no redirigía a
     `/login`: `removeQueries` tras logout confía en que un refetch en
     segundo plano limpie el usuario, pero TanStack Query conserva los
     últimos datos correctos mientras ese refetch está en curso — la UI se
     quedaba pegada en `/admin`. Mismo arreglo que el punto 1
     (`setQueryData(key, null)` es determinista, no depende de un refetch).

**E2E** (Playwright + Chromium, instalado con `sudo apt-get install nodejs
npm` y `playwright install --with-deps chromium`): specs de fase 0
reescritas para iniciar sesión de verdad (antes entraban a `/admin`/`/pos`
sin autenticar, que ya no es válido); nuevo
`backend/scripts/seed_e2e_users.py` (idempotente) siembra el admin/cajero
fijos contra los que loguean, enganchado en `.github/workflows/ci.yml` y
`make seed-e2e`. 9/9 specs en verde, incluida la que detectó el bug del
logout.

Deuda técnica conocida:

- No hay pantallas de administración de usuarios/roles en `/admin` todavía
  (la API está completa y documentada en `/api/docs`); se añaden cuando una
  fase posterior las necesite, para no construir UI sin caso de uso ni test
  E2E que la ejercite.
- `auth_sessions` no tiene todavía un job de limpieza de filas expiradas
  (no afecta a la corrección, sólo crecimiento de tabla); candidato natural
  para `app/jobs` cuando esa fase llegue.
- `frontend/tests/routing.test.tsx` corre bajo `happy-dom` en vez de
  `jsdom` (el resto del frontend sigue en `jsdom`): un bug conocido de
  Vitest 3.x ([vitest-dev/vitest#8374](https://github.com/vitest-dev/vitest/issues/8374))
  hace que jsdom pise el `AbortController` nativo de Node y rompa las
  navegaciones internas de React Router 7 bajo test. Corregido en Vitest 4
  (aún beta); revisar si se puede volver a `jsdom` al actualizar.

## Fase 2 — Auditoría

**Objetivo:** rastro de auditoría *append-only* que registra quién hizo qué,
sobre qué entidad, con qué datos antes/después — sin que la aplicación
pueda nunca modificarlo o borrarlo una vez escrito.

Entregado:

- **`audit_log`**: `user_id` (nullable — acciones de sistema como el
  bootstrap del primer admin no tienen sesión), `action`, `entity_type`,
  `entity_id`, `before_data`/`after_data` (`JSONB`), `request_id`, `ip`,
  `created_at`. Sin `updated_at` a propósito: una fila que pudiera
  actualizarse no sería un rastro de auditoría.
- **`app.audit.service`** expone únicamente `record()` (insertar) y
  `list_entries()` (leer, con filtros por entidad/usuario) — no existe
  ninguna función de actualización o borrado; la regla "append-only desde
  la aplicación" está impuesta por la ausencia de esa función, no sólo
  documentada. `record()` toma `user_id`/`request_id`/`ip` de los
  *contextvars* de la fase 0 (`app.core.context`) y corre en la misma
  transacción que la mutación que audita — o se comitan juntos o hacen
  rollback juntos, nunca puede haber una mutación sin su fila de auditoría.
- **Enganchado en la fase 1**: alta/edición/desactivación de usuario, cambio
  de contraseña (auditado sin exponer nunca antes/después de la contraseña),
  alta de rol y cambio de permisos de un rol. `app.rbac.router` se separó en
  `app.rbac.service` (antes tenía la lógica inline) para poder llamar a
  auditoría igual que ya hacía `app.users.service`. El bootstrap del primer
  admin también audita su propia creación (`action="bootstrap_created"`).
- **`GET /audit-log`** (filtros `entity_type`/`entity_id`/`user_id`,
  paginado), protegido por el nuevo permiso `audit.read`, concedido a
  `ADMIN` por la migración de esta fase.
- **Corregido un fallo real que dejó la fase 1**: la migración de fase 1
  sembraba `ALL_PERMISSIONS`/`ROLE_SEED` — nombres que iban a *crecer* en
  cada fase futura. Al re-ejecutar `alembic upgrade head` desde cero, la
  migración de fase 1 habría sembrado también los permisos de fase 2 (que en
  ese punto de la historia "no existían todavía"), y la migración de fase 2
  habría fallado al intentar insertar la misma clave otra vez
  (`duplicate key value violates unique constraint`). Arreglado
  congelando cada fase a su propia constante inmutable
  (`PHASE_1_PERMISSIONS`/`PHASE_1_ROLE_GRANTS`,
  `PHASE_2_PERMISSIONS`/`PHASE_2_ROLE_GRANTS`, …) — documentado en el
  docstring de `app.rbac.permissions` para que no se repita en fases
  futuras. Verificado migrando una base de datos nueva desde cero.

Archivos añadidos/tocados: `backend/app/audit/*` (nuevo),
`backend/app/rbac/service.py` (nuevo), `backend/app/rbac/router.py`
(simplificado para usar el servicio), `backend/app/rbac/permissions.py`
(constantes por fase), `backend/app/users/service.py` (llamadas de
auditoría), `backend/app/auth/bootstrap.py` (audita la creación del primer
admin), `backend/app/db/registry.py`, `backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_2_audit_log.py`,
`backend/migrations/versions/…_phase_1_auth_and_rbac.py` (fix de las
constantes, ver arriba),
`backend/tests/{test_audit_service,test_audit_router}.py`.

Endpoints nuevos: `GET /audit-log`.

Migración: `c3b32af1d80b_phase_2_audit_log` — crea `audit_log`; siembra el
permiso `audit.read` y lo concede a `ADMIN`. `downgrade()` deshace también
el seed (borra el permiso y su concesión, no sólo la tabla) — verificado con
un *round-trip* completo.

Tests: 12 nuevos (81 en total). `ruff`, `ruff format --check` y `mypy`
limpios; `pytest -q` → 81/81 contra PostgreSQL real.

Deuda técnica conocida:

- No hay pantalla de auditoría en `/admin` todavía (mismo criterio que la
  fase 1: la API está completa y documentada en `/api/docs`, la UI se añade
  cuando una fase la necesite).
- Sin frontend nuevo en esta fase (auditoría es puramente backend), no hizo
  falta re-verificar Vitest/Playwright — sólo se confirmó que la base de
  datos de E2E sigue migrando limpia con la nueva migración.
