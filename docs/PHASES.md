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
| 3 | Productos | ✅ completada |
| 4 | Precios | ✅ completada |
| 5 | Proveedores | ✅ completada |
| 6 | Compras | ✅ completada |
| 7 | Inventory ledger | ✅ completada |
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

## Fase 3 — Productos

**Objetivo:** catálogo de productos con presentaciones (cajas) y códigos de
barra, con el stock siempre pensado en la unidad base del producto (regla
3), aunque el *ledger* de inventario en sí llega en la fase 7.

Entregado:

- **`products`**: sku único, nombre, descripción, categoría, unidad base,
  coste, PVP, tipo de IVA, `price_formula` (columna ya reservada — la fase 4
  la interpreta), stock mínimo, `track_lots`/`track_expiration`, `is_active`
  (regla 14: nunca se borra).
- **`product_categories`**: independientes de las categorías POS de la fase
  10 (mismo nombre de tabla, otra entidad — el propio módulo lo documenta).
- **`product_packages`**: presentaciones con `factor` de conversión a la
  unidad base (regla 4). Cada producto recibe automáticamente su
  presentación base (`factor=1`, `is_base=True`) al crearse — no es un paso
  aparte, para que nunca exista un producto sin dónde vivir su stock.
- **`product_barcodes`**: código de barras único por presentación (una caja
  y un brick del mismo producto pueden escanearse por separado).
  `GET /products/barcode/{barcode}` resuelve producto + presentación desde
  un escaneo — pensado para las fases 9 (recepciones) y 12 (POS).
- **Permisos**: `product.read` (incluido `CASHIER`, lo necesitará el POS) y
  `product.manage` (`ADMIN`/`MANAGER`).
- **Corregido durante la propia fase**: `get_product()` no forzaba
  `populate_existing`, así que releer un producto justo después de
  mutarlo (en la misma transacción) devolvía los `Decimal` tal cual los
  mandó el cliente en vez de los que Postgres normalizó a `NUMERIC(18,6)`
  — mismo valor numérico, precisión distinta según si la lectura caía en la
  misma petición o en una posterior. Detectado por los tests de
  aceptación (5/6: factor exacto de brick/caja), no por revisión de
  código.
- Ajustado `test_rbac_permissions.py::test_cashier_can_log_in_but_only_has_pos_access`
  (renombrado a `..._but_has_no_admin_access`): asumía el conjunto exacto de
  permisos de `CASHIER`, que crece fase a fase (ahora incluye
  `product.read`, como anticipa el propio enunciado de la fase 1). El test
  correcto comprueba lo que nunca debe tener, no una lista cerrada.

Archivos añadidos/tocados: `backend/app/catalog/*` (nuevo),
`backend/app/rbac/permissions.py` (`PHASE_3_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_3_products.py`,
`backend/tests/{test_catalog_products,test_catalog_categories}.py`,
`backend/tests/test_rbac_permissions.py` (fix).

Endpoints nuevos: `GET|POST /product-categories` ·
`GET|POST /products`, `GET /products/{id}`, `GET /products/barcode/{barcode}`,
`PATCH /products/{id}`, `POST /products/{id}/deactivate`,
`POST /products/{id}/packages`,
`POST /products/{id}/packages/{package_id}/barcodes`.

Migración: `911bc003c81e_phase_3_products` — crea `product_categories`,
`products`, `product_packages`, `product_barcodes`; siembra
`product.read`/`product.manage` y los concede a `ADMIN`/`MANAGER` (sólo
lectura a `CASHIER`). `downgrade()` deshace también el seed; verificado con
*round-trip* completo.

Tests: 13 nuevos + 1 corregido (94 en total). `ruff`, `ruff format --check`
y `mypy` limpios; `pytest -q` → 94/94 contra PostgreSQL real.

Deuda técnica conocida:

- Sin pantallas de catálogo en `/admin` todavía (mismo criterio que fases 1
  y 2: la API está completa y documentada en `/api/docs`; la UI llega
  cuando una fase la consuma — el propio POS en la fase 12, por ejemplo).
- `price_formula` es sólo una columna de texto por ahora; la fase 4 añade
  el parser seguro que la interpreta (regla 12: nunca `eval()`).

## Fase 4 — Precios

**Objetivo:** fórmulas de precio definidas por el usuario, evaluadas sin
`eval()`/`exec()` (regla 12), con histórico completo de cambios de precio
(regla 7: cambiar el precio actual nunca reescribe lo que fue en el
pasado).

Entregado:

- **`app.pricing.formula`**: parser/evaluador seguro. Analiza la fórmula con
  el módulo `ast` de Python y camina el árbol con un intérprete propio de
  lista blanca — sólo `+ - * /`, paréntesis (implícitos en el AST),
  las variables `cost`/`tax_rate`/`surcharge_rate`/`margin_rate` y las
  funciones `round`/`ceil`/`floor` son alcanzables; cualquier otro nodo
  (acceso a atributos, subíndices, comparaciones, lambdas, llamadas a
  cualquier otra cosa) se rechaza **antes** de evaluar nada — el árbol
  nunca llega al evaluador real de Python. 22 tests unitarios, incluidos
  varios intentos de escape (`__import__('os')...`, `().__class__...`,
  `open(...)`, `exec()`/`eval()`, `lambda`, comparaciones...).
- **`product_price_history`**: *append-only* como `audit_log` (misma
  filosofía, sin `updated_at`) — una fila por cambio de precio real, nunca
  modificada ni borrada.
- **`app.pricing` es la única vía de escritura** de coste/PVP/IVA/recargo/
  margen/fórmula desde esta fase: `ProductUpdate` (fase 3) perdió esos
  campos — antes de esta fase existían dos caminos para cambiar un precio
  (uno auditado con histórico, otro no); ahora sólo hay uno, y por eso el
  histórico nunca puede quedarse corto. `products.margin_rate` y
  `surcharge_rate` se añadieron con `server_default='0'` para no romper
  filas ya existentes.
- Cambiar `cost`/`tax_rate`/`surcharge_rate`/`margin_rate` en un producto
  con fórmula activa **recalcula el precio automáticamente**; fijar un
  precio manual limpia la fórmula (un precio manual siempre gana sobre una
  fórmula que lo sobrescribiría en el siguiente cambio de coste).
- **Permiso `pricing.manage`** (`ADMIN`/`MANAGER`) para todo lo que muta
  precio; previsualizar una fórmula y leer el histórico sólo necesitan
  `product.read` (ya lo tiene `CASHIER`).

Archivos añadidos/tocados: `backend/app/pricing/*` (nuevo),
`backend/app/catalog/presenters.py` (nuevo — `Product`→`ProductRead`
compartido entre `catalog.router` y `pricing.router`, en vez de que uno
importe el "privado" del otro), `backend/app/catalog/{models,schemas,service}.py`
(precio sale de `ProductUpdate`; `margin_rate`/`surcharge_rate` en el
modelo), `backend/app/rbac/permissions.py` (`PHASE_4_*`),
`backend/app/db/registry.py`, `backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_4_pricing.py`,
`backend/tests/{test_pricing_formula,test_pricing_router}.py`,
`backend/tests/test_catalog_products.py` (el PATCH de precio se sustituyó
por uno de `min_stock`, ya que el precio ya no vive ahí).

Endpoints nuevos: `POST /pricing/preview` ·
`GET /products/{id}/pricing/history` ·
`PATCH /products/{id}/pricing` ·
`PUT|DELETE /products/{id}/pricing/formula` ·
`PUT /products/{id}/pricing/manual-price`.

Migración: `3c00d4e8913b_phase_4_pricing` — crea `product_price_history`;
añade `products.surcharge_rate`/`margin_rate` (`server_default='0'`,
verificado que no rompe con filas existentes); siembra `pricing.manage` y
lo concede a `ADMIN`/`MANAGER`. `downgrade()` deshace también el seed;
verificado con *round-trip* completo y `alembic check`.

Tests: 32 nuevos (126 en total). `ruff`, `ruff format --check` y `mypy`
limpios; `pytest -q` → 126/126 contra PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de precios en `/admin` todavía (mismo criterio que fases
  1–3): la API está completa y documentada en `/api/docs`.
- `product_price_history` no se enlaza todavía con ventas (fase 11) —
  cuando existan, cada línea de venta guardará su propio *snapshot* de
  precio (regla 6), independiente de esta tabla.

## Fase 5 — Proveedores

**Objetivo:** ficha de proveedor y qué productos vende cada uno (su propio
SKU y coste), como base para pedidos de compra (fase 6) y recepciones
(fase 9).

Entregado:

- **`suppliers`**: nombre, CIF/NIF, email, teléfono, dirección, `is_active`
  (regla 14: nunca se borra — las compras lo referenciarán desde la fase 6).
- **`product_suppliers`**: enlace producto↔proveedor con el SKU y coste
  *del proveedor* para ese producto — independiente de `products.cost`
  (que es lo que pagamos la última vez). Único por `(product_id,
  supplier_id)`; `PUT` hace *upsert* (crear o actualizar el mismo enlace,
  nunca duplicarlo). Un enlace marcado `is_preferred` no puede borrarse sin
  fijar antes otro proveedor preferente (409) — evita que un producto se
  quede sin proveedor preferente por accidente.
- **Permisos**: `supplier.read`/`supplier.manage` (`ADMIN`/`MANAGER`;
  `CASHIER` no necesita ver proveedores).
- **Corregido durante la propia fase**: mismo bug de precisión que la fase 3
  (`populate_existing` ausente) — reaparece aquí porque
  `upsert_product_supplier` hacía `session.refresh(existing,
  attribute_names=["product", "supplier"])`, que sólo refresca esas dos
  relaciones y deja `supplier_cost` con el `Decimal` exacto recién asignado
  en vez del normalizado por Postgres a `NUMERIC(18,6)`. Detectado por los
  tests (`"0.80" != "0.800000"`), no por revisión de código. Mismo arreglo:
  releer con `populate_existing=True` en vez de `refresh()` selectivo.

Archivos añadidos/tocados: `backend/app/suppliers/*` (nuevo),
`backend/app/rbac/permissions.py` (`PHASE_5_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_5_suppliers.py`,
`backend/tests/test_suppliers.py`.

Endpoints nuevos: `GET|POST /suppliers`, `GET /suppliers/{id}`,
`PATCH /suppliers/{id}`, `POST /suppliers/{id}/deactivate`,
`GET /suppliers/{id}/products` · `GET /products/{id}/suppliers`,
`PUT|DELETE /products/{id}/suppliers/{supplier_id}`.

Migración: `aaec241cb81f_phase_5_suppliers` — crea `suppliers`,
`product_suppliers`; siembra `supplier.read`/`supplier.manage` para
`ADMIN`/`MANAGER`. `downgrade()` deshace también el seed; verificado con
*round-trip* completo y `alembic check`.

Tests: 15 nuevos (137 en total). `ruff`, `ruff format --check` y `mypy`
limpios; `pytest -q` → 137/137 contra PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de proveedores en `/admin` todavía (mismo criterio que fases
  1–4).
- El histórico de compras por producto ("consultar desde la ficha de
  producto, más reciente primero") es explícitamente de la fase 6
  (`purchase_orders`), no de ésta.

## Fase 6 — Compras

**Objetivo:** pedidos de compra con líneas que guardan snapshot económico
(regla 6), sin todavía tocar inventario — recibir mercancía es la fase 9,
una vez existan el *ledger* (fase 7) y los lotes (fase 8) sobre los que
recibir.

Entregado:

- **`purchase_orders`**/**`purchase_order_lines`**: estados `DRAFT →
  ORDERED → CANCELLED` en esta fase (el enum completo — incluidos
  `PARTIALLY_RECEIVED`/`RECEIVED` — se define ya, para que la fase 9 no
  tenga que migrar nada, sólo añadir comportamiento). Cada línea
  congela `package_name`/`package_factor`/`unit_cost`/`tax_rate`/
  `discount_rate` en el momento de crearse — cambiar después el coste del
  producto o el factor de una presentación nunca reescribe un pedido ya
  hecho. `quantity_received` existe desde ya (arranca en 0), lista para que
  la fase 9 la use sin migración adicional.
- Un pedido sólo admite líneas en `DRAFT`; `POST .../place` exige al menos
  una línea y pasa a `ORDERED` con `ordered_at`; `POST .../cancel` funciona
  desde `DRAFT` u `ORDERED`, nunca desde un estado que ya implique recepción
  (eso es fase 9).
- Los totales de línea/pedido (subtotal, descuento, impuesto, total) se
  **calculan**, nunca se almacenan — deterministas a partir de los
  *snapshots* inmutables, así que no hay nada que pueda desincronizarse.
- **`GET /products/{id}/purchase-history`**: histórico de compras del
  producto, más reciente primero — fecha, proveedor, cantidad, precio,
  presentación, tal y como pide el enunciado.
- **Permisos**: `purchase.read`/`purchase.manage` (`ADMIN`/`MANAGER`).
- **Corregido durante la propia fase**: los totales computados (p. ej.
  `subtotal = quantity_packages * unit_cost`) salían con hasta 12 decimales
  al multiplicar dos `Decimal` de 6 decimales cada uno — aritmética exacta
  (regla 8 cumplida), pero inconsistente con el resto de la API, que
  siempre muestra 6 decimales por venir de columnas `NUMERIC(18,6)`.
  Detectado por los tests (`"20.000000000000" != "20.000000"`). Arreglado
  cuantizando cada total calculado a la misma escala de 6 decimales
  (`NUMERIC_EPSILON`, ya definido en `app.db.types` desde la fase 0).

Archivos añadidos/tocados: `backend/app/purchasing/*` (nuevo),
`backend/app/rbac/permissions.py` (`PHASE_6_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_6_purchasing.py`,
`backend/tests/test_purchasing.py`.

Endpoints nuevos: `GET|POST /purchase-orders`, `GET /purchase-orders/{id}`,
`POST /purchase-orders/{id}/lines`,
`DELETE /purchase-orders/{id}/lines/{line_id}`,
`POST /purchase-orders/{id}/place`, `POST /purchase-orders/{id}/cancel` ·
`GET /products/{id}/purchase-history`.

Migración: `586da6716605_phase_6_purchasing` — crea `purchase_orders`,
`purchase_order_lines`; siembra `purchase.read`/`purchase.manage` para
`ADMIN`/`MANAGER`. `downgrade()` deshace también el seed; verificado con
*round-trip* completo y `alembic check`.

Tests: 14 nuevos (151 en total), incluido el caso de aceptación #9 del plan
(pedido de 100 unidades). `ruff`, `ruff format --check` y `mypy` limpios;
`pytest -q` → 151/151 contra PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de compras en `/admin` todavía (mismo criterio que fases
  1–5).
- `PARTIALLY_RECEIVED`/`RECEIVED` y el aumento real de inventario son
  explícitamente de la fase 9, no de ésta — ver el *docstring* de
  `app.purchasing`.

## Fase 7 — Inventory ledger

**Objetivo:** el inventario deja de ser un número — pasa a ser la suma de un
histórico de movimientos (regla 1), con una proyección (`stock_balance`)
que siempre puede reconstruirse desde cero a partir de él (regla 2), y que
se actualiza en la misma transacción que cada movimiento (regla 5).

Entregado:

- **`stock_movements`** (*append-only*, sin `updated_at`, sin update/delete
  en `app.inventory.service`): `product_id`, `warehouse_id`, `location_id`,
  `quantity` con signo (unidad base, regla 3), `movement_type`
  (`PURCHASE_RECEIPT`/`SALE`/`RETURN`/`ADJUSTMENT`/`WASTE`/`TRANSFER_IN`/
  `TRANSFER_OUT`), `reference_type`/`reference_id`, `unit_cost` (*snapshot*,
  regla 6), `user_id`. **Sin `lot_id` todavía** a propósito — la fase 8
  crea `lots`, y añadir esa columna antes tendría que referenciar una tabla
  inexistente.
- **`warehouses`/`locations`**: el enunciado da por hecho que existen (los
  usa como clave de `stock_balance`) sin dedicarles una fase propia; se
  crean aquí porque el *ledger* los necesita. Sembrado un almacén/ubicación
  por defecto (*"Tienda principal"* / *"Almacén"*) — dato de referencia,
  como los roles de la fase 1: sin fase de "alta inicial", una tienda no
  puede mover stock sin que exista al menos uno.
- **`stock_balance`**: única tabla no *append-only* del módulo — es
  explícitamente una proyección, reconstruible en cualquier momento.
- **`record_movement`**, el punto de paso único que usarán las fases 9
  (recepciones), 11 (ventas) y 14 (devoluciones) para tocar stock: escribe
  el movimiento y actualiza `stock_balance` en la misma transacción vía
  `INSERT ... ON CONFLICT DO UPDATE` de Postgres — atómico tanto si la fila
  de balance ya existe como si es la primera vez que se toca esa
  combinación producto/almacén/ubicación.
- Manual ya disponible en esta fase (antes de que existan recepciones/
  ventas): `POST /stock-movements/adjustments` (`ADJUSTMENT`/`WASTE` — este
  último siempre se normaliza a negativo aunque se mande en positivo) y
  `POST /stock-movements/transfers` (`TRANSFER_OUT`+`TRANSFER_IN` pareados,
  atómicos).
- **`POST /stock-balance/rebuild`**: borra `stock_balance` entera y la
  reconstruye sumando `stock_movements` — la capacidad que pide
  explícitamente el enunciado, con su prueba automática
  (`test_rebuild_stock_balance_reproduces_identical_balances`): crea
  movimientos, compara el balance antes/después de reconstruir, deben ser
  idénticos.
- **Prueba de concurrencia real** (no simulada): 10 tareas `asyncio`
  concurrentes, cada una con su propia conexión que hace *commit* de verdad
  (`committing_sessionmaker`, ya preparado desde la fase 0 para esto),
  incrementan en 1 el mismo producto/almacén/ubicación; el resultado final
  debe ser 10, ni menos.
- **Permisos**: `inventory.read` (incluido `CASHIER`, el POS de la fase 12
  necesita ver stock) / `inventory.manage` (`ADMIN`/`MANAGER`).
- **Dos fallos reales encontrados por los tests, no por revisión de
  código**:
  1. La primera implementación usaba `SELECT ... FOR UPDATE` y creaba la
     fila de `stock_balance` si no existía. `FOR UPDATE` sólo bloquea filas
     que **ya existen** — dos movimientos concurrentes sobre una
     combinación nueva pueden ver ambos "no hay fila" e intentar
     insertarla a la vez; el segundo choca con la restricción única
     (`duplicate key value violates unique constraint`). Sólo lo detectó la
     prueba de concurrencia real, ejecutándose contra PostgreSQL de verdad
     — una prueba con mocks nunca lo habría visto. Arreglado con
     `INSERT ... ON CONFLICT DO UPDATE`, que resuelve alta y actualización
     concurrente en una sola sentencia que Postgres serializa internamente.
  2. Mismo patrón de precisión que en fases 3 y 5: `record_movement`
     devolvía el objeto `StockMovement` con el `Decimal` exacto recién
     asignado (`"-2"`) en vez del normalizado por Postgres a
     `NUMERIC(18,6)` (`"-2.000000"`). Arreglado con
     `session.refresh(movement)` tras el `flush()`.

Archivos añadidos/tocados: `backend/app/inventory/*` (nuevo),
`backend/app/rbac/permissions.py` (`PHASE_7_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_7_inventory_ledger.py`,
`backend/tests/test_inventory.py`.

Endpoints nuevos: `GET|POST /warehouses`,
`GET|POST /warehouses/{id}/locations` · `GET /stock-movements`,
`GET /stock-balance`, `POST /stock-movements/adjustments`,
`POST /stock-movements/transfers`, `POST /stock-balance/rebuild`.

Migración: `b10c54df868a_phase_7_inventory_ledger` — crea `warehouses`,
`locations`, `stock_balance`, `stock_movements`; siembra
`inventory.read`/`inventory.manage` y el almacén/ubicación por defecto.
`downgrade()` deshace también el seed de permisos (el almacén por defecto
desaparece solo al borrarse la tabla); verificado con *round-trip* completo
y `alembic check`.

Tests: 22 nuevos (162 en total), incluidas la prueba de reconstrucción
exigida por el enunciado y una prueba de concurrencia real contra
PostgreSQL. `ruff`, `ruff format --check` y `mypy` limpios; `pytest -q` →
162/162.

Deuda técnica conocida:

- Sin pantalla de inventario en `/admin` todavía (mismo criterio que fases
  1–6).
- `lot_id` llega en la fase 8; hasta entonces todo movimiento es a nivel de
  producto/almacén/ubicación, sin lote.
