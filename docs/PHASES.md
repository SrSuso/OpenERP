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
| 8 | Lotes y caducidad | ✅ completada |
| 9 | Recepciones | ✅ completada |
| 10 | Categorías POS | ✅ completada |
| 11 | Ventas | ✅ completada |
| 12 | POS | ✅ completada |
| 13 | Pagos | ✅ completada |
| 14 | Devoluciones | ✅ completada |
| 15 | Tickets | ✅ completada |
| 16 | Dashboards | ✅ completada |
| 17 | Notificaciones | ✅ completada |
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

## Fase 8 — Lotes y caducidad

**Objetivo:** lotes con fecha de caducidad y FEFO (*First Expired, First
Out*) — una venta debe poder consumir varios lotes automáticamente,
empezando siempre por el que caduca antes.

Entregado:

- **`lots`**: `product_id`, `lot_number` (único por producto),
  `manufacturing_date`, `expiration_date` (nullable — no todo lote
  caduca), `supplier_id`/`purchase_order_id` (nullable, trazabilidad hacia
  la fase 6). Dónde *está* el stock de un lote sigue viviendo en
  `stock_balance`/`stock_movements` (fase 7); esta tabla es sólo la
  identidad y las fechas del lote.
- **`app.inventory` (fase 7) ampliado con `lot_id`**, tal y como anunciaba
  su propio *docstring*: `stock_movements.lot_id` (nullable, FK a `lots`) y
  `stock_balance.lot_id`. Como `lot_id` es *nullable* (no todo producto
  lleva lote), una única restricción única de 4 columnas no basta —
  Postgres nunca considera iguales dos `NULL`, así que dos movimientos del
  mismo producto sin lote generarían cada uno su propia fila en vez de
  compartir una. Solución: **dos índices únicos parciales**
  (`... WHERE lot_id IS NULL` / `... WHERE lot_id IS NOT NULL`), y
  `_upsert_balance` elige cuál usar como árbitro del `ON CONFLICT` según si
  se pasa `lot_id` o no. Verificado con un test dedicado
  (`test_non_lot_tracked_movements_are_unaffected`) que confirma que los
  productos sin lote se comportan exactamente igual que en la fase 7.
- **`plan_fefo`**: algoritmo puro (no toca la base de datos) que decide de
  qué lotes tomar una cantidad, ordenando por caducidad ascendente (los
  lotes sin fecha se consumen los últimos). **`execute_fefo_consumption`**:
  planifica y ejecuta de verdad, un movimiento de `stock_movements` por
  lote consumido, todo en la misma transacción (regla 5) — el mecanismo
  exacto que la fase 11 conectará al cobro de una venta
  (`movement_type="SALE"`); ya alcanzable ahora para ajustes/mermas
  manuales que también deben respetar FEFO.
- Caso de aceptación #12 del enunciado verificado literalmente
  (`test_fefo_consume_matches_the_spec_example_end_to_end`): lote A con 2
  unidades (caduca antes) + lote B con 10; vender 5 dispersa el consumo
  automáticamente por varios lotes — A queda en 0, B en 7.
- **Permisos**: `lot.read` (incluido `CASHIER`) / `lot.manage`
  (`ADMIN`/`MANAGER`).

Archivos añadidos/tocados: `backend/app/lots/*` (nuevo),
`backend/app/inventory/{models,service,schemas,router}.py` (`lot_id`),
`backend/app/rbac/permissions.py` (`PHASE_8_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_8_lots.py`,
`backend/tests/test_lots.py`.

Endpoints nuevos: `GET|POST /lots`, `GET /lots/{id}` ·
`GET /products/{id}/lot-balances`,
`POST /products/{id}/fefo-plan` (sólo planifica),
`POST /products/{id}/fefo-consume` (planifica y ejecuta) · `stock-movements`/
`stock-balance` (fase 7) ahora aceptan/devuelven `lot_id`.

Migración: `70fc407a2e6d_phase_8_lots` — crea `lots`; añade `lot_id` a
`stock_movements`/`stock_balance` con sus FKs; sustituye la restricción
única simple de `stock_balance` por los dos índices únicos parciales;
siembra `lot.read`/`lot.manage`. `downgrade()` deshace todo, incluida la
restricción única original; verificado con *round-trip* completo y
`alembic check`.

Tests: 11 nuevos (173 en total), incluido el caso de aceptación FEFO
literal del enunciado. `ruff`, `ruff format --check` y `mypy` limpios;
`pytest -q` → 173/173 contra PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de lotes en `/admin` todavía (mismo criterio que fases
  1–7).
- `execute_fefo_consumption` es genérico (`movement_type` libre a nivel de
  servicio); el endpoint HTTP sólo expone `ADJUSTMENT`/`WASTE` a propósito
  — `SALE` queda reservado para que la fase 11 lo dispare desde el propio
  flujo de cobro, nunca desde este endpoint manual.

## Fase 9 — Recepciones

**Objetivo:** cerrar el ciclo compra→almacén: recibir mercancía contra un
pedido de compra (fase 6) genera movimiento(s) reales en el ledger de
inventario (fase 7), opcionalmente etiquetados con lote (fase 8), y hace
avanzar el estado del pedido según lo que falte por llegar. Vive dentro del
propio módulo `app.purchasing`, tal y como anunciaba su *docstring* desde la
fase 6 ("Purchase orders (phase 6) and their goods receipts (phase 9)") — no
es un paquete nuevo.

Entregado:

- **`goods_receipts`** (cabecera: pedido, almacén, ubicación, notas,
  fecha, usuario) y **`goods_receipt_lines`** (línea de pedido de origen,
  cantidad en el envase con el que se pidió, lote opcional, y el
  `stock_movement_id` real que generó — trazabilidad completa hacia el
  ledger de la fase 7).
- `create_goods_receipt`: por cada línea recibida, valida que la cantidad
  no exceda lo pendiente (`quantity_ordered - quantity_received`, en
  unidades base), crea/reutiliza el lote si se indica `lot_number`
  (reutilizando `app.lots.service`), llama a
  `app.inventory.service.record_movement` con
  `movement_type="PURCHASE_RECEIPT"` (el único punto de entrada al ledger,
  regla 1) y actualiza `quantity_received` de la línea del pedido. Todo en
  una única transacción (regla 5); se audita con antes/después del pedido
  (`action="goods_received"`).
- **Transición de estado del pedido**: `ORDERED`/`PARTIALLY_RECEIVED` →
  `PARTIALLY_RECEIVED` si queda algo pendiente, o `RECEIVED` si todas las
  líneas quedan completas. Recibir contra un pedido `DRAFT` o `CANCELLED`
  se rechaza (409). El caso de aceptación del enunciado se verifica
  literalmente: pedido de 100, recibir 60 → `PARTIALLY_RECEIVED` y stock
  +60; recibir las 40 restantes → `RECEIVED` y stock total +100
  (`test_receiving_60_of_100_leaves_the_order_partially_received`,
  `test_receiving_the_remaining_40_completes_the_order`).
- El coste unitario del movimiento de inventario se deriva del coste del
  pedido (`unit_cost / package_factor`, es decir, coste por unidad base),
  igual que en el resto del sistema (regla 8: siempre `Decimal`).
- **Permisos**: `receiving.read` / `receiving.manage` (`ADMIN`/`MANAGER`).

Archivos añadidos/tocados: `backend/app/purchasing/models.py`
(`GoodsReceipt`, `GoodsReceiptLine`),
`backend/app/purchasing/{schemas,service,router}.py`,
`backend/app/rbac/permissions.py` (`PHASE_9_*`),
`backend/migrations/versions/…_phase_9_receiving.py`,
`backend/tests/test_receiving.py`. No hizo falta tocar
`app/db/registry.py` ni `app/api/v1/router.py`: los modelos nuevos viven en
el paquete ya registrado de la fase 6 y los endpoints se añaden al router
ya montado.

Endpoints nuevos: `POST /purchase-orders/{id}/receipts`,
`GET /purchase-orders/{id}/receipts`, `GET /goods-receipts/{id}`.

Migración: `77605c60bee5_phase_9_receiving` — crea `goods_receipts`,
`goods_receipt_lines`; siembra `receiving.read`/`receiving.manage`.
`downgrade()` deshace también el seed de permisos; verificado con
*round-trip* completo y `alembic check`.

Tests: 9 nuevos (182 en total), incluido el caso de aceptación 60/40
literal del enunciado, recepción con envases (caja de 6), recepción con
lote (crea el lote y su saldo por lote), exceso de recepción (422),
recepción contra pedido no `ORDERED` (409/422), trazabilidad del
`stock_movement_id` generado, y permisos (`403`/`401`). `ruff`,
`ruff format --check` y `mypy` limpios; `pytest -q` → 182/182 contra
PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de recepciones en `/admin` todavía (mismo criterio que
  fases 1–8).
- `create_goods_receipt` recibe el pedido una sola vez y muta sus líneas en
  memoria; el objeto que devuelve el propio endpoint de creación viene de
  `get_goods_receipt` (que sí usa `populate_existing=True`), así que la
  respuesta de creación es correcta, pero una lectura de
  `GET /purchase-orders/{id}` en la misma transacción lógica de otro
  cliente no se ve afectada por este detalle (transacciones separadas por
  petición, regla ya establecida en la fase 0).

## Fase 10 — Categorías POS

**Objetivo:** un segundo esquema de categorías, independiente del
`ProductCategory` de estantería (fase 3), pensado para agrupar los botones
de la rejilla del TPV (fase 12) por pestañas con color y orden — tal y
como anticipaba el propio *docstring* de `ProductCategory` desde la fase
3 ("Independent from the POS-facing categories of phase 10"). Vive dentro
de `app.catalog`, no es un paquete nuevo.

Entregado:

- **`pos_categories`**: `name` (único), `color` (hex de 6 dígitos,
  `#64748b` por defecto), `display_order`, `is_active` (regla 14:
  desactivar, nunca borrar — una categoría desactivada deja de listarse
  con `active_only=True`, pero los productos que ya apuntan a ella
  conservan el enlace, por trazabilidad).
- `products.pos_category_id` (nullable — no todo producto tiene botón
  propio) y `products.pos_display_order` (orden dentro de su categoría),
  gestionados a través del `PATCH /products/{id}` ya existente (fase 3):
  no hizo falta un endpoint nuevo, sólo dos campos más en
  `ProductUpdate`/`ProductCreate`.
- `GET /products` acepta ahora `pos_category_id` como filtro (para que la
  fase 12 pida directamente "los productos de esta pestaña", ordenados
  por `pos_display_order`).
- **Permisos**: sólo `pos_category.manage` (`ADMIN`/`MANAGER`) — la
  lectura reutiliza `product.read`, ya concedido a `CASHIER` desde la
  fase 3, siguiendo el mismo patrón que la fase 4 (`PRICING_MANAGE` sin
  un `_READ` propio) ya que el TPV necesita leer categorías POS pero
  nunca gestionarlas.

Archivos añadidos/tocados: `backend/app/catalog/models.py`
(`PosCategory`, columnas `pos_category_id`/`pos_display_order` en
`Product`), `backend/app/catalog/{schemas,service,router,presenters}.py`,
`backend/app/rbac/permissions.py` (`PHASE_10_*`),
`backend/migrations/versions/…_phase_10_pos_categories.py`,
`backend/tests/test_pos_categories.py`. No hizo falta tocar
`app/db/registry.py` ni `app/api/v1/router.py`: `PosCategory` vive en el
paquete ya registrado de la fase 3 y sus endpoints se añaden al router ya
montado.

Endpoints nuevos: `GET|POST /pos-categories`,
`PATCH /pos-categories/{id}`, `POST /pos-categories/{id}/deactivate` ·
`GET /products` ahora acepta `?pos_category_id=`.

Migración: `6682eb0bfca8_phase_10_pos_categories` — crea `pos_categories`;
añade `pos_category_id`/`pos_display_order` a `products` con su FK;
siembra `pos_category.manage`. `downgrade()` deshace también el seed de
permisos; verificado con *round-trip* completo y `alembic check`.

Tests: 12 nuevos (194 en total), incluidos orden por `display_order`,
color por defecto, formato de color inválido (422), nombre duplicado
(409), desactivación (oculta de `active_only` pero sigue en el listado
completo), asignación de producto a categoría inexistente (422), filtro
`GET /products?pos_category_id=` y permisos (`403`/`401`). `ruff`,
`ruff format --check` y `mypy` limpios; `pytest -q` → 194/194 contra
PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de categorías POS en `/admin` todavía (mismo criterio que
  fases 1–9); la propia rejilla del TPV que las consume llega en la fase
  12.
- Un producto sólo puede pertenecer a una categoría POS a la vez (M:1,
  no M:N) — suficiente para "qué botón muestra", que es el único caso de
  uso que la fase 12 necesita; si en el futuro hiciera falta que un
  producto apareciera en varias pestañas, sería una tabla de asociación
  nueva, no un cambio de esta.

## Fase 11 — Ventas

**Objetivo:** el carrito de una venta — abrir una venta, añadir/quitar
líneas con captura de precio/impuesto (rule 7), y cancelarla — sin tocar
todavía ni el stock ni el cobro. El propio *docstring* de `app.sales`
desde la fase 0 ya lo anticipaba: *"Sales, sale lines, payments and atomic
checkout (phases 11, 13)"* — esta fase cubre "sales, sale lines"; "payments
and atomic checkout" es exclusivamente de la fase 13, una vez existan los
pagos. Ninguna línea de esta fase llama a
`app.inventory.service.record_movement` ni a `app.lots.service` — el
stock no se reserva ni se mueve hasta que la fase 13 registre un pago.

Entregado:

- **`sales`**: `warehouse_id`/`location_id` (de dónde se vende — ya
  necesarios para que la fase 13 sepa qué ubicación descontar),
  `status` (`DRAFT`/`COMPLETED`/`CANCELLED` — el enum completo se define
  ya, igual que `PurchaseOrderStatus` hizo para la fase 9, para que la
  fase 13 no necesite migrar nada, sólo añadir comportamiento),
  `cashier_user_id` (nullable, regla 14), `completed_at` (nullable,
  lo rellena sólo la fase 13).
- **`sale_lines`**: mismo patrón de *snapshot* que `PurchaseOrderLine`
  (fase 6) pero en la dirección contraria — el precio canónico
  (`Product.list_price`) es por unidad base, así que cada línea guarda
  `package_factor`/`package_name` y `quantity_base = quantity_packages *
  factor` (regla 3), y copia `unit_price`/`tax_rate` del producto en el
  momento de añadir la línea, sin volver a leerlos nunca (regla 7,
  verificado literalmente:
  `test_line_price_is_a_snapshot_and_ignores_later_price_changes`).
  `discount_rate` por línea, aplicado antes del impuesto
  (`test_discount_rate_is_applied_before_tax`).
- Sólo `DRAFT -> CANCELLED` es alcanzable desde este módulo; añadir o
  quitar líneas exige `DRAFT` (409 en otro caso). Un producto desactivado
  no se puede vender (422, regla 14).
- **Alta por código de barras** (`POST /sales/{id}/lines/by-barcode`):
  reutiliza `app.catalog.service.get_product_by_barcode` para que el TPV
  (fase 12) pueda escanear directamente sin resolver antes el producto en
  el frontend.
- **Permisos**: a diferencia de todos los módulos anteriores, `CASHIER`
  recibe tanto `sale.read` como `sale.manage` — cobrar es su trabajo, no
  sólo algo que consulta.

Archivos añadidos/tocados: `backend/app/sales/*` (nuevo),
`backend/app/rbac/permissions.py` (`PHASE_11_*`),
`backend/app/db/registry.py`, `backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_11_sales.py`,
`backend/tests/test_sales.py`. De paso se limpió un comentario obsoleto
en `api/v1/router.py` que hacía referencia a un `receiving.router` que
nunca existió (la fase 9 montó sus endpoints en `purchasing_router`
directamente).

Endpoints nuevos: `GET|POST /sales`, `GET /sales/{id}`,
`POST /sales/{id}/lines`, `POST /sales/{id}/lines/by-barcode`,
`DELETE /sales/{id}/lines/{line_id}`, `POST /sales/{id}/cancel`.

Migración: `2573ff5a5eb7_phase_11_sales` — crea `sales`, `sale_lines`;
siembra `sale.read`/`sale.manage`. `downgrade()` deshace también el seed
de permisos; verificado con *round-trip* completo y `alembic check`.

Tests: 11 nuevos (205 en total), incluidos el *snapshot* de precio
inmune a cambios posteriores, venta por caja (conversión a unidades
base), descuento aplicado antes del impuesto, alta por código de barras,
eliminar una línea recalcula el total, producto desactivado rechazado,
transición a `CANCELLED` y rechazo de mutaciones tras cancelar,
ubicación que no pertenece al almacén (422), y permisos
(incluido que `CASHIER` sí puede gestionar). `ruff`, `ruff format --check`
y `mypy` limpios; `pytest -q` → 205/205 contra PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de ventas en `/admin` ni rejilla en `/pos` todavía (la
  propia fase 12 es esa UI); esta fase es sólo la API del carrito.
- No se comprueba disponibilidad de stock al añadir una línea — a
  propósito: la disponibilidad sólo se comprueba, atómicamente con el
  cobro, en la fase 13 (igual que un TPV real no reserva stock sólo por
  tener algo en el ticket). Añadir más de lo que hay en almacén a un
  `DRAFT` es válido; fallará al intentar cobrarlo si sigue sin stock
  suficiente.

## Fase 12 — POS

**Objetivo:** la rejilla táctil de `/pos` que un cajero usa de verdad para
construir el ticket — categorías (fase 10), productos (fase 3), carrito
(fase 11) y código de barras, todo sobre la API que las fases anteriores ya
dejaron completa. Puramente frontend: no hay endpoints, tablas ni
migraciones nuevas. Cobrar sigue sin estar aquí a propósito — la fase 13
añade pagos/checkout sobre esta misma venta `DRAFT`.

Entregado:

- **Resolución de sesión del TPV**: al entrar, `PosHomePage` resuelve el
  primer almacén activo (`GET /warehouses`) y su primera ubicación activa
  (`GET /warehouses/{id}/locations`) — hoy sólo existe el almacén sembrado
  por la fase 7 (*"Tienda principal"* / *"Almacén"*), pero no se asume un id
  fijo. Con eso resuelto, reanuda la venta `DRAFT` que ese almacén ya
  tuviera abierta (`GET /sales?status=DRAFT&warehouse_id=`, la más reciente
  si hubiera más de una) o abre una nueva (`POST /sales`) — recargar la
  página nunca pierde el ticket en curso.
- **`ProductGrid`**: rejilla táctil de botones; tocar uno añade una unidad
  de la presentación base del producto (`POST /sales/{id}/lines`) —
  escoger otra presentación/cantidad desde la rejilla queda fuera de
  alcance a propósito, ver deuda técnica.
- **`CategoryTabs`**: pestañas por categoría POS (fase 10, con su color),
  más una pestaña *"Todos"* sin filtro — no hay una categoría de backend
  para "todos", es sólo la ausencia de `pos_category_id` en la query.
- **Código de barras**: campo de texto que un lector físico también puede
  rellenar (escribe el código y un `Enter`), que llama a
  `POST /sales/{id}/lines/by-barcode` (fase 11) sin pasar por la rejilla.
- **`Cart`**: las líneas de la venta actual, con su total, botón para
  quitar cada línea (`DELETE /sales/{id}/lines/{line_id}`) y **Cancelar
  venta** (`POST /sales/{id}/cancel`) — cancelar reabre automáticamente una
  venta nueva (mismo mecanismo de resolución de sesión de arriba), así que
  el TPV queda utilizable al instante.
- **Corregido antes de cerrar la fase** (código ya escrito en una sesión
  anterior, sin commitear): `ProductGrid` llamaba a `basePackage(product)`
  sin importarlo de `@/features/pos/api` — no compilaba (`tsc -b`, que a
  diferencia de `tsc --noEmit` suelto sí construye `tsconfig.app.json` de
  verdad; el `--noEmit` suelto no había detectado nada al no compilar
  ningún archivo) — y tenía un ternario sin efecto en el precio mostrado
  (`factor === '1.000000' ? list_price : list_price`, ambas ramas iguales).
  Arreglado mostrando directamente `product.list_price`.
- **Bug real encontrado por los tests, no por revisión de código**: cancelar
  la venta y que el TPV abriera una nueva sólo funcionaba la primera vez.
  `PosHomePage` guarda la sesión de venta en estado local, resuelta una vez
  contra la caché de TanStack Query de `GET /sales?status=DRAFT&...`; esa
  caché nunca se invalidaba tras cancelar, así que el efecto que "reanuda o
  abre" resucitaba la venta que se acababa de cancelar en vez de abrir una
  de verdad. Detectado por `PosHomePage.test.tsx` (mock de backend con
  estado propio, no sólo respuestas fijas por endpoint), no por revisión.
  Arreglado sincronizando esa caché explícitamente
  (`queryClient.setQueryData`) en el `onSuccess` de abrir y de cancelar.
- **`backend/scripts/seed_e2e_catalog.py`** (nuevo, idempotente, mismo
  patrón que `seed_e2e_users.py` de la fase 1): siembra una categoría POS y
  dos productos con código de barras — sin esto la rejilla del TPV estaría
  siempre vacía en un entorno nuevo. Enganchado en `make seed-e2e-catalog` y
  en `.github/workflows/ci.yml`, junto al seed de usuarios ya existente.

Archivos añadidos/tocados: `frontend/src/lib/format.ts` (nuevo —
`formatMoney`/`formatQuantity`, único punto que convierte un
`NUMERIC(18,6)` en texto), `frontend/src/features/pos/{api,CategoryTabs,
ProductGrid,Cart}.tsx` (nuevos), `frontend/src/pages/pos/PosHomePage.tsx`
(sustituye el *placeholder* de la fase 0), `backend/scripts/seed_e2e_catalog.py`
(nuevo), `Makefile` (`seed-e2e-catalog`), `.github/workflows/ci.yml` (paso
de seed), `docs/USAGE.md` (§6, nueva), `tests/e2e/specs/pos.sale.spec.ts`
(nuevo).

Endpoints nuevos: ninguno — fase puramente de frontend sobre la API de las
fases 3/7/10/11.

Migración: ninguna.

Tests: 26 nuevos en frontend (Vitest + React Testing Library) —
`lib/format.test.ts` (6, incluye negativos y redondeo a 3 decimales),
`CategoryTabs.test.tsx` (4), `ProductGrid.test.tsx` (6, estados pendiente/
error/vacío/deshabilitado incluidos), `Cart.test.tsx` (6), y
`PosHomePage.test.tsx` (4, con un *fake* de backend con estado propio en vez
de respuestas fijas, para poder probar reanudar/cancelar/recargar de
verdad) — este último es el que encontró el bug de caché descrito arriba.
`tsc -b`, `eslint` y `prettier --check` limpios; `vitest run` → 26/26 (más
las que ya había: `lib/api.test.ts`). 4 specs E2E nuevas
(`tests/e2e/specs/pos.sale.spec.ts`, proyecto `pos` con `hasTouch`): tocar
producto añade línea y quitarla la vacía, código de barras añade línea,
cancelar vacía el carrito y dejar el TPV listo al instante, recargar
reanuda la misma venta — 13/13 specs E2E en verde (incluidas las de fases
0/1 sin tocar), dos pasadas consecutivas sin *flakiness*. Backend sin
cambios: `pytest -q` sigue en 205/205.

Deuda técnica conocida:

- Un cajero sólo puede vender **una unidad de la presentación base** por
  toque — elegir una presentación distinta (p. ej. una caja en vez de una
  unidad), una cantidad distinta de 1, o un descuento por línea, todo ya
  soportado por `POST /sales/{id}/lines` (fase 11), no tiene UI todavía.
  Candidato natural para un modal/*long-press* cuando haga falta, sin tocar
  el backend.
- **La sesión de venta es por almacén, no por cajero ni por terminal**:
  `GET /sales?status=DRAFT&warehouse_id=` no filtra por
  `cashier_user_id`, así que dos cajeros (o dos pestañas) abiertos a la vez
  contra el mismo almacén reanudarían y mutarían el mismo ticket — correcto
  para el único TPV que existe hoy (un almacén, una ubicación, sembrados
  por la fase 7), pero no aguanta varios terminales físicos por tienda. Lo
  expuso la propia suite E2E (dos tests de `pos.sale.spec.ts` corriendo en
  paralelo se pisaban el ticket el uno al otro); el spec se dejó en
  ejecución serial (`test.describe.serial`) como mitigación de test, no
  como arreglo de producto. Una fase futura que necesite multi-terminal
  añadiría un identificador de sesión/terminal explícito al filtro.
- Sin pantalla de ventas en `/admin` todavía (mismo criterio que fases
  1–11): la API está completa y documentada en `/api/docs`.
- No hay botón de cobro — a propósito, es la fase 13.

## Fase 13 — Pagos

**Objetivo:** el checkout atómico que cierra el ciclo de la venta: comprobar
stock disponible, cobrar (uno o varios métodos de pago), mover el
inventario (FEFO para productos con lote) y marcar la venta `COMPLETED` —
todo en una única transacción (regla 5), tal y como anticipaba el
*docstring* de `app.sales.models` desde la fase 11. Botón **Cobrar** en el
TPV, sobre la misma venta `DRAFT` que las fases 11/12 ya construían.

Entregado:

- **`payments`** (*append-only*, mismo criterio que `audit_log`/
  `product_price_history`): `sale_id`, `method`
  (`CASH`/`CARD`/`OTHER`), `amount` — lo que el cliente entregó, no lo que
  la caja se queda (una entrega en efectivo mayor que el total no se
  recorta aquí; el sobrante sale como cambio, calculado, no almacenado).
- **`POST /sales/{id}/checkout`**: acepta una lista de pagos (permite pago
  mixto, p. ej. parte tarjeta + parte efectivo). Rechaza (422) si la suma
  no cubre el total, o si sobra importe sin que haya un pago en efectivo
  que lo cubra (no se puede "dar cambio" de una tarjeta). El cambio
  (`change_due`) se calcula, nunca se guarda — igual que los totales de
  línea desde la fase 11.
- **Comprobación de stock, por fin real**: la fase 11 dejó explícitamente
  sin comprobar la disponibilidad al añadir una línea ("fallará al
  intentar cobrarlo si sigue sin stock suficiente") — este es ese momento.
  Por cada línea, `app.inventory.service.lock_and_get_available_quantity`
  bloquea (`SELECT ... FOR UPDATE`) todas las filas de `stock_balance` de
  ese producto/ubicación (todos los lotes si los tiene) antes de decidir
  si hay suficiente — bloquear primero y decrementar después, en la misma
  transacción, es lo que hace la comprobación segura bajo concurrencia real
  (dos cobros a la vez para el último ejemplo del catálogo no pueden ver
  ambos "hay suficiente"). Postgres no permite `FOR UPDATE` junto a un
  agregado, así que se bloquean las filas una a una y se suman en Python en
  vez de un único `SELECT SUM(...) ... FOR UPDATE`.
- **Movimiento de inventario por línea**: `movement_type=SALE`,
  `reference_type="sale"`, `reference_id=<sale.id>` — para productos con
  lote, vía `app.lots.service.execute_fefo_consumption` (el mecanismo que
  la fase 8 dejó ya listo, literalmente a la espera de que "la fase 13 lo
  dispare desde el propio flujo de cobro"); para el resto, un
  `record_movement` directo. Cualquier fallo a mitad (falta de stock en la
  línea 2 de 3, por ejemplo) deshace **toda** la petición — nada de venta
  completada con sólo parte del stock descontado — gracias a la política de
  una transacción por petición de la fase 0, no a lógica añadida aquí.
- Sólo `DRAFT -> COMPLETED` es alcanzable desde `checkout`; una venta que
  ya esté `COMPLETED`/`CANCELLED` lo rechaza (409), y una vez `COMPLETED`
  tampoco admite añadir/quitar líneas ni cancelarla (mismo guard de estado
  de la fase 11, ahora alcanzable con un tercer valor).
- **Frontend**: botón **Cobrar** en `Cart` (fase 12), habilitado sólo con
  el carrito no vacío; `Checkout.tsx` (nuevo) — efectivo/tarjeta, importe
  editable con vista previa de cambio en vivo, tarjeta siempre exacta;
  `Receipt.tsx` (nuevo) — confirmación con lo cobrado y el cambio a
  entregar, con **Nueva venta** que reutiliza el mismo mecanismo de
  "reanudar o abrir" de la fase 12 (limpia la caché de ventas `DRAFT` y
  deja que el efecto ya existente abra una venta nueva).
- **`backend/scripts/seed_e2e_catalog.py` ampliado**: desde esta fase
  también siembra stock (1000 unidades) de cada producto nuevo — cobrar
  necesita existencia real, no sólo que el producto exista.

Archivos añadidos/tocados: `backend/app/sales/models.py` (`Payment`,
`PaymentMethod`), `backend/app/sales/{schemas,service,presenters,router}.py`
(`checkout`, `CheckoutRequest`/`PaymentCreate`/`PaymentRead`,
`SaleRead.payments`/`change_due`), `backend/app/inventory/service.py`
(`lock_and_get_available_quantity`),
`backend/migrations/versions/…_phase_13_payments.py`,
`backend/tests/test_checkout.py` (nuevo), `backend/scripts/seed_e2e_catalog.py`
(stock), `frontend/src/features/pos/{api,Cart}.tsx` (checkout/`Tender`,
botón **Cobrar**), `frontend/src/features/pos/{Checkout,Receipt}.tsx`
(nuevos), `frontend/src/pages/pos/PosHomePage.tsx` (orquesta cobrar/recibo),
`tests/e2e/specs/pos.sale.spec.ts` (checkout, renombrado a "phases 12/13").
No hizo falta ningún permiso nuevo: `checkout` reutiliza `sale.manage`
(`CASHIER` ya lo tiene desde la fase 11 — cobrar es su trabajo).

Endpoints nuevos: `POST /sales/{id}/checkout`.

Migración: `6996851d411a_phase_13_payments` — crea `payments`; sin siembra
de permisos (ninguno nuevo). `downgrade()` la elimina; verificado con
*round-trip* completo y `alembic check`.

Tests: 12 nuevos en backend (217 en total) — cobro exacto en efectivo mueve
stock y completa la venta, pago mixto tarjeta+efectivo, sobrepago en
efectivo calcula el cambio, sobrepago con tarjeta sin efectivo se rechaza,
importe insuficiente se rechaza y la venta queda `DRAFT`, stock
insuficiente se rechaza atómicamente (verificado que ni el stock ni los
pagos cambian), venta sin líneas rechazada, doble cobro rechazado, venta
`COMPLETED` rechaza añadir/quitar líneas y cancelar, venta cancelada
rechaza el cobro, consumo FEFO multi-lote a través del propio checkout
(mismo caso de aceptación que la fase 8, ahora disparado por `/checkout` en
vez de por el endpoint manual), y una prueba de concurrencia real (dos
ventas queriendo agotar el mismo stock a la vez: exactamente una gana, el
balance final es 0, nunca negativo). `ruff`, `ruff format --check` y `mypy`
limpios; `pytest -q` → 217/217 contra PostgreSQL real.

**Frontend**: 20 tests nuevos (57 en total) — `Checkout.tsx` (8: importe por
defecto, tarjeta bloquea el importe exacto, aviso si no cubre el total,
vista previa de cambio, confirmar con el método/importe correctos, volver,
error, deshabilitado mientras está pendiente), `Receipt.tsx` (5), botón
**Cobrar** en `Cart.tsx` (3 nuevos), y el flujo completo en
`PosHomePage.test.tsx` (2 nuevos, con el mismo *fake* de backend con estado
propio de la fase 12). `tsc -b`, `eslint` y `prettier --check` limpios;
`vitest run` → 57/57; `vite build` limpio. 6 specs E2E nuevas en
`pos.sale.spec.ts` (cobro exacto muestra recibo y deja una venta nueva
lista, sobrepago en efectivo muestra el cambio, volver desde el cobro no
cobra nada) — 16/16 specs E2E en verde, dos pasadas consecutivas sin
*flakiness*.

Deuda técnica conocida:

- Sólo se admite un método de pago "simple" por *tender* (sin
  desglose de propina, sin pago aplazado/fiado); suficiente para una tienda
  minorista con TPV único, ampliable sin tocar el modelo si hiciera falta.
- El límite por almacén, no por cajero/terminal, de la fase 12 sigue
  vigente aquí (`checkout` opera sobre la venta `DRAFT` que ya exista,
  cualquiera que sea su origen) — mismo criterio, misma nota de deuda
  técnica que la fase 12.
- Sin pantalla de ventas/pagos en `/admin` todavía (mismo criterio que
  fases 1–12).
- Imprimir un ticket físico es explícitamente la fase 15; `Receipt.tsx` es
  sólo la confirmación en pantalla que el cajero necesita antes de entregar
  el cambio.

## Fase 14 — Devoluciones

**Objetivo:** deshacer una venta ya `COMPLETED`, línea a línea, con el
reembolso económico y la reposición física de existencias como conceptos
independientes (regla 9) — un artículo dañado se reembolsa sin volver al
lineal; un cambio de artículo vuelve al lineal sin reembolso; lo habitual
es ambos a la vez, pero nunca están acoplados. Vive en `app.returns`, el
paquete que la fase 0 ya reservaba ("Refunds and physical restocking, kept
independent").

Entregado:

- **`returns`/`return_lines`**: una devolución cuelga de una venta
  (`sale_id`) y cada línea cuelga de la línea de venta original
  (`sale_line_id`), de la que hereda `package_name`/`package_factor` (una
  devolución nunca reelige presentación) y cuyas tasas snapshotted
  (`unit_price`/`tax_rate`/`discount_rate`, reglas 6/7) usa para calcular
  el reembolso — nunca las del producto tal y como está hoy.
- **`is_economic`/`is_physical`**, independientes por línea (regla 9); al
  menos una debe ser verdadera (validado por Pydantic, 422 si no). El
  reembolso (`refund_amount`) se calcula con la misma fórmula que
  `compute_line_totals` de la fase 11, escalada a la cantidad devuelta, y
  es 0 si `is_economic` es falso — nunca se guarda si no hay reembolso
  real. El movimiento de inventario (`movement_type=RETURN`, ya reservado
  en el enum de la fase 7) sólo se genera si `is_physical` es verdadero;
  para un producto con lote hace falta indicar a qué lote vuelve
  (`lot_number`, crea o reutiliza — misma conveniencia que una recepción,
  fase 9); sin él, 422.
- **`sale_lines.quantity_returned`** (nueva columna, `default 0`): el
  mismo patrón que `PurchaseOrderLine.quantity_received` (fases 6/9) —
  tope acumulado que impide devolver más de lo vendido, ya sea de una vez
  o a lo largo de varias devoluciones parciales (422 si se excede).
- Sólo procede contra una venta `COMPLETED` — una `DRAFT`/`CANCELLED`
  nunca llegó a entregar nada, así que no hay nada que devolver (422). El
  estado de la propia venta (`SaleStatus`) no cambia por una devolución —
  su enum ya se cerró en la fase 11 ("definido en su totalidad"); llevar la
  cuenta vive enteramente en `quantity_returned`.
- **Permisos nuevos, con un criterio distinto al de ventas**:
  `return.read`/`return.manage`, sólo `ADMIN`/`MANAGER` — a diferencia de
  `sale.manage`, `CASHIER` no los recibe: deshacer dinero y stock de una
  venta ya cerrada es aquí una acción de supervisión, no el trabajo
  cotidiano del cajero (mismo criterio que `purchase.manage`/
  `receiving.manage`, no el de `sale.manage`).

Archivos añadidos/tocados: `backend/app/returns/*` (nuevo — `models`,
`schemas`, `service`, `presenters`, `router`), `backend/app/sales/models.py`
(`SaleLine.quantity_returned`), `backend/app/sales/{schemas,presenters}.py`
(lo exponen), `backend/app/rbac/permissions.py` (`PHASE_14_*`),
`backend/app/db/registry.py`, `backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_14_returns.py`,
`backend/tests/test_returns.py`, `frontend/src/features/pos/api.ts`
(`saleLineSchema` gana `quantity_returned`, sin UI de devoluciones todavía
— ver deuda técnica).

Endpoints nuevos: `POST /sales/{id}/returns`, `GET /sales/{id}/returns`,
`GET /returns`, `GET /returns/{id}`.

Migración: `2c00d9c49c90_phase_14_returns` — crea `returns`/`return_lines`;
añade `sale_lines.quantity_returned`; siembra `return.read`/
`return.manage` para `ADMIN`/`MANAGER`. `downgrade()` deshace también el
seed de permisos; verificado con *round-trip* completo y `alembic check`.

Tests: 14 nuevos (231 en total) — devolución sólo económica no toca stock,
devolución sólo física no reembolsa, devolución completa hace ambas cosas,
exceso sobre lo vendido rechazado (de una vez y acumulado en varias
devoluciones parciales), línea sin economic ni physical rechazada por
Pydantic, devolución contra venta `DRAFT` rechazada, línea que no
pertenece a la venta rechazada, producto con lote sin `lot_number`
rechazado, producto con lote con `lot_number` crea el lote y el stock
aparece ahí, `CASHIER` sin acceso (403), `ADMIN`/`MANAGER` sí, listar por
venta y por query param, y por id. `ruff`, `ruff format --check` y `mypy`
limpios; `pytest -q` → 231/231 contra PostgreSQL real. Frontend: `tsc -b`,
`eslint`, `prettier --check`, `vitest run` (57/57, sin tests nuevos propios
de esta fase) y `vite build` limpios — el único cambio de frontend es el
esquema Zod, que las suites ya existentes ejercitan. 16/16 specs E2E siguen
en verde (esta fase no añade ninguna: sin UI que probar).

Deuda técnica conocida:

- Sin pantalla de devoluciones en `/admin` todavía (mismo criterio que
  fases 1–13: la API está completa y documentada en `/api/docs`).
- Una devolución no puede repartirse entre varios lotes de origen aunque
  la venta original sí consumiera varios vía FEFO (fase 8) — se asume que
  el cliente devuelve una cantidad que encaja en un único lote de destino;
  suficiente para el caso de uso real (el cliente no suele saber de qué
  lote salió su unidad), ampliable sin romper el modelo si hiciera falta.

## Fase 16 — Dashboards

**Objetivo:** paneles configurables de verdad — widgets que un administrador
añade y quita — sobre un *query builder* de lista blanca (regla 13: nunca
SQL arbitrario). Vive en `app.dashboards`, el paquete que la fase 0 ya
reservaba. Primera pantalla real de `/admin` (fases 1–15 sólo tenían
`/api/docs`): el panel de administración deja de ser un placeholder.

Entregado:

- **La lista blanca en sí** (`app.dashboards.metrics.MetricKey`): cuatro
  métricas fijas — `sales_over_time`, `top_products`, `stock_value`,
  `low_stock_count` — cada una con su propio esquema Pydantic de
  parámetros y su propia consulta SQLAlchemy escrita a mano. No existe
  ningún camino desde el `params` guardado de un widget hasta una cadena
  de SQL: `run_metric` sólo puede despachar a una de estas cuatro
  funciones Python, nunca interpretar nada. Añadir una métrica significa
  añadir aquí una tripleta clave/parámetros/consulta, en revisión de
  código — nunca algo que un cuerpo de petición pueda hacer crecer por su
  cuenta.
- **`dashboards`/`dashboard_widgets`**: un panel es una colección de
  widgets; cada widget guarda `metric` + `params` (JSONB, validado contra
  el esquema de esa métrica en cada escritura) + `chart_type`
  (presentación pura — nunca cambia qué se consulta). Los datos de un
  widget (`GET .../data`) se calculan en el momento, siempre — nunca hay
  caché ni nada que pueda quedar desactualizado en silencio.
- **Cada métrica, una consulta agregada real** (no traer filas a Python
  para sumarlas): `sales_over_time` agrupa ventas `COMPLETED` por día;
  `top_products` ordena por ingresos o unidades, con la misma fórmula de
  `compute_line_totals` (fase 11) expresada como aritmética SQL en vez de
  Python; `stock_value` suma `quantity * cost` de `stock_balance`;
  `low_stock_count` cuenta productos cuyo stock agregado cae por debajo de
  `min_stock`. Corregido antes de que fuera un bug real: multiplicar dos
  columnas `NUMERIC(18,6)` en SQL desborda a más decimales
  (`30.000000000000` en vez de `30.000000`) — mismo patrón que en fases
  6/9/11/13, cuantizado de vuelta antes de servir la respuesta.
- **Frontend**: primera pantalla real de `/admin` — `AdminHomePage`
  auto-crea "Mi panel" la primera vez que no existe ninguno (mismo
  mecanismo de "abrir si no hay uno" que la fase 12 usó para la venta),
  renderiza sus widgets con ECharts (`EChart.tsx`, envoltorio imperativo
  único — el proyecto depende de `echarts` sin *binding* de React) y deja
  añadir/quitar widgets desde un formulario. Paleta y trazos siguen la
  skill de *dataviz* del propio proyecto: una sola serie por gráfico usa
  un color consistente (nunca "arcoíris" por barra, ya que el eje de
  categoría ya distingue identidad), sin leyenda para una sola serie, y el
  KPI de stock bajo empareja siempre color de estado con icono + texto,
  nunca sólo color.
- **Permisos**: `dashboard.read`/`dashboard.manage`, sólo `ADMIN`/`MANAGER`
  — mismo criterio que compras/recepciones, no el de ventas.

Archivos añadidos/tocados: `backend/app/dashboards/*` (nuevo — `models`,
`metrics`, `schemas`, `service`, `presenters`, `router`),
`backend/app/rbac/permissions.py` (`PHASE_16_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_16_dashboards.py`,
`backend/tests/test_dashboards.py`,
`frontend/src/features/dashboards/*` (nuevo — `api`, `EChart`,
`SalesOverTimeChart`, `TopProductsChart`, `KpiTile`, `Widget`,
`AddWidgetForm`, más sus tests), `frontend/src/pages/admin/AdminHomePage.tsx`
(sustituye el *placeholder* de la fase 0), `frontend/tests/setup.ts`
(`ResizeObserver` — jsdom no lo implementa), `tests/e2e/specs/dashboard.spec.ts`.

Endpoints nuevos: `GET /dashboard-metrics` · `GET|POST /dashboards`,
`GET /dashboards/{id}`, `POST /dashboards/{id}/widgets`,
`DELETE /dashboards/{id}/widgets/{widget_id}`,
`GET /dashboards/{id}/widgets/{widget_id}/data`.

Migración: `d39d8f23fa71_phase_16_dashboards` — crea `dashboards`/
`dashboard_widgets`; siembra `dashboard.read`/`dashboard.manage` para
`ADMIN`/`MANAGER`. `downgrade()` deshace también el seed de permisos;
verificado con *round-trip* completo y `alembic check`.

Tests: 15 nuevos en backend (268 en total) — cada métrica cubierta
(agregación diaria, orden por ingresos/unidades, valor de inventario,
conteo bajo mínimo), widget con parámetros que no encajan en la métrica
rechazado (422), métrica desconocida rechazada, `date_from` posterior a
`date_to` rechazado, widget inexistente 404, `CASHIER` sin acceso (403),
`MANAGER` sí, no autenticado 401. Encontrado y corregido durante la propia
fase: una fuga real de datos entre tests — una prueba de concurrencia real
de la fase 13 (`committing_sessionmaker`, sin *rollback* automático) deja
una venta `COMPLETED` de verdad en la base de datos de test; los tests que
agregan "todo lo visible hoy" tuvieron que aislarse creando su propio
almacén dedicado en vez de confiar en el compartido "Tienda principal".
`ruff`, `ruff format --check` y `mypy` limpios; `pytest -q` → 268/268
contra PostgreSQL real. Frontend: 28 tests nuevos (85 en total) —
`KpiTile` (3), `AddWidgetForm` (7, campos condicionales por métrica),
`Widget` (10, incluida la petición jsdom-sin-canvas: los dos componentes
de gráfico se sustituyen por un doble en el test, mismo criterio que
`window.print()` en E2E — jsdom no tiene `<canvas>` real), `AdminHomePage`
(5, auto-creación, añadir/quitar widget). `tsc -b`, `eslint`,
`prettier --check`, `vitest run` y `vite build` limpios. 4 specs E2E
nuevas (`dashboard.spec.ts`, serializado por compartir el único panel que
`AdminHomePage` renderiza, con limpieza de widgets vía API antes de cada
test — mismo motivo que `resetCart` en la fase 12) — 21/21 specs E2E en
verde, dos pasadas consecutivas sin *flakiness*, incluida la comprobación
de que el `<canvas>` de ECharts se pinta de verdad en Chromium.

Deuda técnica conocida:

- Un panel no está limitado a su creador todavía: `GET /dashboards`
  devuelve todos, y `AdminHomePage` siempre usa el primero — funciona
  porque hoy sólo existe uno ("Mi panel", auto-creado), pero varios
  administradores acabarían compartiendo el mismo panel. Añadir
  `owner_user_id` como filtro (la columna ya existe) es la ampliación
  natural si hiciera falta un panel por administrador.
- El formulario de "añadir widget" está escrito a mano por métrica en vez
  de generarse desde el JSON Schema que `GET /dashboard-metrics` ya
  expone — con sólo cuatro métricas no compensaba construir un generador
  de formularios genérico; si el catálogo crece, ese endpoint ya da lo
  necesario para hacerlo.
- El bundle de `/admin` crece con ECharts (aviso de Vite al construir,
  ~935KB sin comprimir) — no se ha aplicado *code-splitting* por ruta
  todavía; candidato natural para la fase 20 (Rendimiento).
- Sin edición de un widget existente (sólo añadir/quitar) — cambiar sus
  parámetros hoy es quitarlo y añadirlo de nuevo.

## Fase 17 — Notificaciones

**Objetivo:** reglas de notificación configurables que detectan
condiciones reales del negocio (stock bajo mínimo, lotes por caducar),
abren un incidente por cada una y lo mantienen deduplicado — evaluar dos
veces la misma condición nunca crea un segundo incidente, y una condición
que deja de cumplirse se cierra sola. Vive en `app.notifications`, el
paquete que la fase 0 ya reservaba. Puramente backend: no hay caso de uso
en el TPV, y `/admin` ya tiene su propio criterio de "sin pantalla todavía"
(fases 1–14) para lo que no la necesita con urgencia.

Entregado:

- **La lista blanca, otra vez** (`app.notifications.rules.RuleType`): el
  mismo patrón que `app.dashboards.metrics.MetricKey` de la fase 16 —
  `LOW_STOCK` y `EXPIRING_LOT`, cada una con su propio esquema Pydantic de
  parámetros y su propio detector SQLAlchemy escrito a mano. Una regla
  guardada nunca puede convertirse en SQL arbitrario, sólo en una llamada a
  una de estas dos funciones.
- **`notification_rules`/`incidents`**: una regla apunta a un tipo +
  parámetros; evaluarla (`app.notifications.service.evaluate_rules`)
  produce cero o más "detecciones" (sujeto + mensaje), y es esa función —
  no el detector — la que decide qué hacer con cada una: abrir un
  incidente nuevo, refrescar `last_seen_at` en uno ya abierto, o
  resolver uno abierto cuyo sujeto ya no aparece entre las detecciones.
- **La deduplicación la impone la base de datos, no sólo el código**:
  índice único parcial `(rule_id, subject_type, subject_id) WHERE status =
  'OPEN'` — el mismo mecanismo que la fase 8 ya usó para el saldo de stock
  con/sin lote. Como mucho un incidente abierto por regla y sujeto a la
  vez.
- **`evaluate_rules` es idempotente**, pensado para que la fase 18 lo
  dispare desde un *worker* programado sin cambiar nada aquí — hoy se
  dispara a mano vía `POST /notifications/evaluate`.
- **Bug real encontrado por los tests, no por revisión de código**:
  `evaluate_rules` construía/recuperaba objetos `Incident` sin la relación
  `rule` precargada; el *presenter* lee `incident.rule.name`, y esa carga
  perezosa fuera del contexto async de la petición hacía saltar
  `MissingGreenlet`. Arreglado asignando `incident.rule = rule`
  directamente — la propia función ya tiene la regla en la mano en cada
  punto donde toca un incidente, así que no hace falta ninguna consulta
  adicional para precargarla.
- **Permisos**: `notification.read`/`notification.manage`, sólo
  `ADMIN`/`MANAGER` — mismo criterio que dashboards/compras/recepciones.

Archivos añadidos/tocados: `backend/app/notifications/*` (nuevo —
`models`, `rules`, `schemas`, `service`, `presenters`, `router`),
`backend/app/rbac/permissions.py` (`PHASE_17_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_17_notifications.py`,
`backend/tests/test_notifications.py`.

Endpoints nuevos: `GET|POST /notification-rules`,
`PATCH /notification-rules/{id}`, `POST /notifications/evaluate` ·
`GET /incidents`, `GET /incidents/{id}`, `POST /incidents/{id}/resolve`.

Migración: `c6c84b0f03e1_phase_17_notifications` — crea
`notification_rules`/`incidents` (con el índice único parcial de
deduplicación); siembra `notification.read`/`notification.manage` para
`ADMIN`/`MANAGER`. `downgrade()` deshace también el seed de permisos;
verificado con *round-trip* completo y `alembic check`.

Tests: 10 nuevos (278 en total) — `LOW_STOCK` detecta un producto bajo
mínimo y no marca uno por encima, evaluar dos veces no duplica el
incidente (comprobado también a nivel de listado, no sólo por id),
resolución automática al reponer stock, `EXPIRING_LOT` detecta un lote
dentro de la ventana y no uno lejano, parámetros que no encajan
rechazados (422), desactivar una regla la excluye de la evaluación,
resolución manual, `CASHIER` sin acceso (403), no autenticado 401. Las
aserciones de detección comprueban "mi sujeto aparece/no aparece" en vez
de "la lista completa mide N" — mismo criterio de aislamiento frente a
datos de otras pruebas que la fase 16 tuvo que aplicar (una prueba de
concurrencia real, sin *rollback*, puede dejar productos/movimientos de
verdad en la base de datos de test). `ruff`, `ruff format --check` y
`mypy` limpios; `pytest -q` → 278/278 contra PostgreSQL real.

Deuda técnica conocida:

- Sin pantalla de notificaciones en `/admin` todavía — a diferencia de la
  fase 16, aquí no había una superficie obvia que la necesitara ya (el
  panel de administración recién nacido no tiene aún un sitio natural para
  una bandeja de incidentes); candidato claro para cuando la fase 18 la
  dispare periódicamente y de verdad haga falta verla sin pedirla a mano.
- Sólo dos tipos de regla (`LOW_STOCK`, `EXPIRING_LOT`) — el mismo patrón
  de lista blanca hace trivial añadir más (pedidos de compra atascados,
  devoluciones pendientes) cuando haga falta, sin tocar el modelo.
- La evaluación es manual (`POST /notifications/evaluate`) — la fase 18
  es la que la convierte en periódica de verdad, y la que además dispara
  el envío por correo de lo que detecte.

## Fase 15 — Tickets

**Objetivo:** el recibo imprimible de una venta cobrada, en texto
monoespaciado para rollo térmico de 58/80mm, a partir de una plantilla
*versionada* — editar la plantilla nunca reescribe un ticket ya impreso
(regla 6/7 aplicada al propio recibo). Vive en `app.tickets`, el paquete
que la fase 0 ya reservaba ("Versioned receipt templates for 58mm/80mm
printing"). Botón **Imprimir ticket** en el TPV, sobre la venta ya cobrada
que la fase 13 dejó lista.

Entregado:

- **`ticket_templates`**: sólo una plantilla activa a la vez en toda la
  tienda (no varias familias en paralelo — un TPV imprime un único
  formato). Crear una nueva desactiva la anterior; **`revise_template`**
  es la única forma de cambiar qué imprime una plantilla ya usada — nunca
  muta la fila existente, la retira (`is_active=False`) y crea una versión
  nueva (`version + 1`) bajo el mismo `name`, así que revisar la plantilla
  activa (409 si se intenta revisar una ya retirada) nunca reescribe lo
  que un ticket antiguo señala.
- **`tickets`**: uno por venta como máximo (`UniqueConstraint`), generado
  una única vez — `generate_ticket` es idempotente: la segunda llamada
  devuelve la misma fila, con el mismo `rendered_text` ya congelado, sin
  volver a renderizar aunque la plantilla activa haya cambiado entre
  medias (verificado literalmente: cambiar la plantilla y reimprimir sigue
  mostrando la cabecera original). Sólo procede contra una venta
  `COMPLETED` (fase 13) — antes de cobrar no hay pagos ni total definitivo
  que imprimir.
- **`app.tickets.render`**: función pura (sin base de datos) que da forma
  al texto — cabecera/pie centrados, línea de venta y fecha, cada línea de
  producto con cantidad/precio/total, desglose de impuestos opcional
  (según la plantilla), pagos por método, y cambio sólo si hubo sobrepago
  en efectivo. `CHARS_PER_WIDTH` fija 32/48 caracteres para 58/80mm; cada
  línea generada se verifica que cabe en el ancho declarado. Corregido
  *antes* de que fuera un bug real: formatear una cantidad entera como
  `100` usando `Decimal.normalize()` puede volcar a notación científica
  (`1E+2`) — evitado a propósito con `quantize()` + `:f` en vez de
  `normalize()`.
- **Frontend**: botón **Imprimir ticket** en `Receipt.tsx` (fase 13) que
  genera/recupera el ticket y muestra el texto monoespaciado en pantalla,
  disparando `window.print()`; una regla CSS global
  (`.ticket-print-root`, `src/index.css`) oculta el resto de la página al
  imprimir — el truco clásico de "imprime sólo este elemento", sin tocar
  el resto del árbol de componentes.
- **`backend/scripts/seed_e2e_catalog.py` ampliado de nuevo**: siembra una
  plantilla activa por defecto — sin ella, imprimir en un entorno nuevo
  fallaría con 422 ("sin plantilla activa configurada").
- **Permisos**: sólo `ticket.manage` (`ADMIN`/`MANAGER`), para gestionar
  plantillas — generar/leer el ticket de una venta reutiliza `sale.read`
  (`CASHIER` ya lo tiene desde la fase 11): imprimir es sólo renderizar
  una venta que el cajero ya puede ver, no una capacidad nueva.

Archivos añadidos/tocados: `backend/app/tickets/*` (nuevo — `models`,
`render`, `schemas`, `service`, `presenters`, `router`),
`backend/app/rbac/permissions.py` (`PHASE_15_*`), `backend/app/db/registry.py`,
`backend/app/api/v1/router.py`,
`backend/migrations/versions/…_phase_15_tickets.py`,
`backend/tests/{test_ticket_render,test_tickets}.py`,
`backend/scripts/seed_e2e_catalog.py` (plantilla por defecto),
`frontend/src/features/pos/{api,Receipt}.tsx`, `frontend/src/index.css`
(`.ticket-print-root`), `frontend/src/features/pos/Receipt.test.tsx`,
`tests/e2e/specs/pos.sale.spec.ts`.

Endpoints nuevos: `GET|POST /ticket-templates`,
`GET /ticket-templates/active`, `POST /ticket-templates/{id}/revise` ·
`POST /sales/{id}/tickets`, `GET /sales/{id}/ticket`.

Migración: `0561a769c519_phase_15_tickets` — crea `ticket_templates`/
`tickets`; siembra `ticket.manage` para `ADMIN`/`MANAGER`. `downgrade()`
deshace también el seed de permisos; verificado con *round-trip* completo
y `alembic check`.

Tests: 22 nuevos en backend (253 en total) — 11 puramente unitarios sobre
`render_ticket` (cabecera/pie, id y fecha, línea con cantidad/precio/
total, desglose de impuestos activable, cambio sólo con sobrepago en
efectivo, métodos de pago traducidos, ningún renglón excede el ancho
declarado en 58/80mm, cantidades enteras sin notación científica) y 11 de
API/servicio (crear plantilla activa y desactiva la anterior, revisar crea
versión nueva, revisar una ya retirada rechazado con 409, generar ticket
para venta completada, generar dos veces es idempotente y el texto queda
congelado aunque la plantilla cambie entre medias, venta `DRAFT` rechazada,
sin plantilla activa rechazado, `GET` antes de generar es 404, `GET`
después coincide, `CASHIER` puede generar/leer pero no gestionar
plantillas, no autenticado 401). `ruff`, `ruff format --check` y `mypy`
limpios; `pytest -q` → 253/253 contra PostgreSQL real. Frontend: 8 tests
nuevos en `Receipt.test.tsx` (60 en total) — genera y muestra el texto del
ticket y dispara `window.print()`, error si falla, "Cerrar" vuelve a la
confirmación; `tsc -b`, `eslint`, `prettier --check`, `vitest run` y
`vite build` limpios. 1 spec E2E nueva (imprimir muestra el texto
renderizado, con `window.print()` interceptado vía
`page.addInitScript` — Playwright no puede pilotar el diálogo nativo del
sistema operativo, así que la propia prueba lo sustituye por un *no-op*
antes de cargar la página, patrón habitual en cualquier suite E2E que
cruza esa frontera) — 17/17 specs E2E en verde, dos pasadas sin
*flakiness*.

Deuda técnica conocida:

- Sin pantalla de gestión de plantillas en `/admin` todavía (mismo
  criterio que fases 1–14): la API está completa y documentada en
  `/api/docs`.
- Sólo hay un formato de plantilla (una cabecera y un pie de texto plano,
  totales y líneas con un diseño fijo) — suficiente para un ticket de
  tienda minorista; una fase futura que necesite logotipos, códigos de
  barra o QR en el propio recibo ampliaría `render_ticket`, no el modelo.
