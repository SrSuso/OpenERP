# Arquitectura y documentación técnica

Documentación de **cómo está construido el código**, para quien vaya a
mantenerlo o extenderlo. Para instalarlo/operarlo en un servidor, ver
[`ADMIN_GUIDE.md`](ADMIN_GUIDE.md); para cómo se usa día a día, ver
[`USER_GUIDE.md`](USER_GUIDE.md); para el histórico de qué se construyó en
cada fase y por qué, ver [`PHASES.md`](PHASES.md) (extenso: es el diario de
diseño completo, no hace falta leerlo para trabajar en el código de hoy).

---

## 1. Visión general

OpenERP es un **monolito modular**: un único backend FastAPI y un único
frontend React, organizados internamente por dominio de negocio en vez de
repartidos en microservicios. La razón (regla de diseño explícita del
proyecto) es que un ERP de tienda tiene módulos fuertemente relacionados
(una venta toca inventario, precios, impuestos y caja a la vez) y separarlos
en servicios independientes habría cambiado transacciones atómicas de una
sola base de datos por llamadas de red entre servicios — más complejidad sin
un beneficio real a esta escala.

| Capa | Tecnología | Por qué |
| --- | --- | --- |
| Backend | Python 3.13, FastAPI, SQLAlchemy 2.x async, Alembic, Pydantic v2, psycopg 3 | Async de extremo a extremo; tipado estático con mypy. |
| Base de datos | PostgreSQL 17 | Único almacén de estado — sin caché ni cola externas (ver outbox más abajo). |
| Frontend | React 19, TypeScript, Vite, React Router 7, TanStack Query, React Hook Form + Zod, Tailwind CSS 4, ECharts | SPA servida como estáticos; habla con la API por `/api/*` del mismo origen. |
| Worker | Proceso Python independiente | Vacía la cola de outbox (envío de correo) — ver §4. |
| Tests | pytest + pytest-asyncio (PostgreSQL real, nunca SQLite), Vitest + Testing Library, Playwright | "Nunca mockear la infraestructura real" es una regla del proyecto, no una preferencia. |

Dos superficies de usuario sobre la misma API y el mismo esquema de datos:

- `/admin` — panel de administración y dashboards.
- `/pos` — punto de venta táctil para cajeros.

---

## 2. Backend: `backend/app/`

### 2.1. Organización por dominio

Cada carpeta bajo `app/` es un módulo de negocio con la misma forma interna
(no todas tienen las cinco piezas — un módulo pequeño puede no necesitar
`schemas.py` propio, por ejemplo):

```
app/<dominio>/
  router.py     # endpoints FastAPI: valida entrada, llama a service, serializa salida
  service.py    # lógica de negocio y transacciones — el único sitio que decide reglas
  models.py     # tablas SQLAlchemy
  schemas.py    # modelos Pydantic de entrada/salida (no son los modelos de BD)
  repository.py # (en los módulos con consultas más complejas) acceso a datos
```

Módulos actuales, por orden de aparición histórica (`docs/PHASES.md` tiene el
detalle de cada uno):

| Módulo | Qué gestiona |
| --- | --- |
| `auth/` | Login, sesiones server-side revocables, bootstrap del primer admin. |
| `users/` | Alta/baja (desactivación, nunca borrado) de usuarios. |
| `rbac/` | Roles y catálogo de permisos. |
| `audit/` | Registro de auditoría de acciones sensibles. |
| `catalog/` | Productos, categorías, presentaciones (unidad base + cajas). |
| `pricing/` | Fórmulas de precio (sin `eval()` — motor propio restringido). |
| `suppliers/` | Proveedores. |
| `purchasing/` | Pedidos de compra y, desde la fase 9, recepciones. |
| `inventory/` | `stock_movements` (histórico, fuente de verdad) y `stock_balance` (proyección). |
| `lots/` | Lotes y caducidad. |
| `sales/` | Ventas, líneas, pagos. |
| `returns/` | Devoluciones económicas y físicas (conceptos independientes). |
| `tickets/` | Plantillas e impresión de recibos 58/80mm. |
| `dashboards/` | Widgets del panel: consultas agregadas predefinidas, nunca SQL libre. |
| `notifications/` | Reglas de incidencias e histórico. |
| `jobs/` | El *outbox* transaccional y su router de consulta (el worker vive aparte, ver §4). |
| `api/` | Router agregador (`v1/router.py`), middleware transversal (`middleware.py`). |
| `core/` | `config.py` (settings), `logging.py`, `errors.py`, `context.py`. |
| `db/` | Base declarativa, tipos `NUMERIC(18,6)`, gestión de sesiones async. |

`app/api/v1/router.py` es el único sitio que conoce a todos los módulos —
cada uno se registra ahí con una línea; añadir un módulo nuevo no toca los
demás.

### 2.2. Configuración: `app/core/config.py`

Un único `Settings` (Pydantic `BaseSettings`) leído de variables de entorno
con prefijo `OPENERP_`, más `.env`. Nada en el código lee `os.environ`
directamente. Puntos a tener en cuenta al desplegar (detalle operativo en
`ADMIN_GUIDE.md`):

- `session_cookie_secure` es una `@property`, no una variable: es `True`
  únicamente cuando `OPENERP_ENVIRONMENT=production`. La cookie de sesión
  llevará `Secure` en ese caso, lo que exige servir por HTTPS — de lo
  contrario el navegador nunca la reenvía y el login parece "no funcionar".
- `cors_origins` acepta una lista separada por comas (no JSON) gracias a un
  validador propio, porque así es como la pasa cualquier plataforma de
  despliegue típica.
- `async_database_url`/`sync_database_url` normalizan cualquier URL
  `postgres://`/`postgresql://` al driver `psycopg` (v3); no hace falta
  escribir el driver a mano en `OPENERP_DATABASE_URL`.

### 2.3. Autenticación y autorización

Sesiones **server-side revocables** tras una cookie `httpOnly`, explícitamente
no JWT: un terminal de TPV compartido o una sesión robada tiene que poder
cerrarse al instante desde el servidor (`DELETE /auth/sessions/{id}`), algo
que un JWT autocontenido no permite sin una lista de revocación aparte.

RBAC de dos niveles: **rol → permisos → recurso**. El catálogo de permisos
(`GET /api/v1/permissions`) es la lista viva; los tres roles sembrados por la
migración de la fase 1 (`ADMIN`, `MANAGER`, `CASHIER`) son sólo el punto de
partida, no una lista cerrada — cualquier `ADMIN` puede crear roles y
reasignar permisos. **Regla 11 del proyecto: los permisos siempre se
comprueban en el backend**, nunca sólo ocultando un botón en el frontend.

### 2.4. Modelo de datos: invariantes que el código protege

Estas son las 15 reglas de arquitectura del proyecto (repetidas en el
`README.md` raíz); cada una tiene tests dedicados que fallan si se rompe:

1. `stock_movements` es el origen histórico del inventario.
2. `stock_balance` es sólo una proyección optimizada, reconstruible desde (1).
3. Todo el stock se almacena en la unidad base del producto.
4. Las presentaciones (cajas) se convierten mediante un factor.
5. Venta, pagos y movimientos de inventario son atómicos (una transacción).
6. Ventas y compras guardan *snapshots* históricos de precios e impuestos.
7. Cambiar precios actuales nunca modifica ventas anteriores.
8. Dinero y cantidades usan `Decimal`/`NUMERIC(18,6)`, nunca `float`.
9. Devolución económica y devolución física son conceptos independientes.
10. SMTP nunca bloquea una venta (ver outbox, §4).
11. Los permisos siempre se comprueban en el backend.
12. Las fórmulas de precio nunca usan `eval()`.
13. Los dashboards nunca ejecutan SQL arbitrario.
14. Productos, proveedores y usuarios con histórico se desactivan, no se borran.
15. Cada fase queda funcionando y probada antes de continuar (regla de proceso, no de datos).

### 2.5. El *outbox* transaccional (`app/jobs/`)

Regla 10 en la práctica: nada en el camino de una petición HTTP abre una
conexión SMTP. Cuando algo necesita enviar un correo (una incidencia nueva,
fase 17), la petición sólo inserta una fila en `outbox_messages` dentro de
su propia transacción — si la venta o la incidencia se confirma, el mensaje
queda encolado; si se revierte, también. `app/jobs/worker.py` es un **proceso
del sistema operativo aparte** (`python -m app.jobs.worker`, o
`make dev-worker` en desarrollo) que sondea la tabla y hace las entregas
SMTP reales, con `SKIP LOCKED` para poder correr varias instancias a la vez
sin duplicar envíos. Si el worker no está arrancado, la aplicación entera
sigue funcionando con total normalidad — los mensajes simplemente se quedan
en `PENDING` hasta que alguno lo levante.

### 2.6. Logging, errores y contexto de petición (`app/core/`, `app/api/middleware.py`)

- `RequestContextMiddleware` genera/propaga un `X-Request-ID` por petición
  y lo mete en el contexto de logging — todo log de esa petición lo lleva.
- `SecurityHeadersMiddleware` añade cabeceras de higiene básica siempre
  (`X-Content-Type-Options`, `X-Frame-Options`, etc.) y `Strict-Transport-
  Security` sólo cuando `environment == "production"` — mismo criterio que
  la cookie `Secure` de §2.2.
- `log_format`: `console` (legible) en desarrollo, `json` (para
  centralizar logs) en producción.
- `register_exception_handlers` traduce las excepciones de dominio a
  respuestas HTTP consistentes; nunca se filtra un *stack trace* al cliente.

### 2.7. Migraciones (`backend/migrations/`, Alembic)

Una migración por fase, nombrada `AAAAMMDD_HHMM-<rev>_<slug>.py`
(`alembic.ini`, `file_template`). Los datos de referencia que no son
secretos (roles y permisos por defecto, por ejemplo) se siembran **desde la
propia migración**, no desde un script aparte — así cualquier base de datos
nueva migrada a `head` queda utilizable sin un paso manual adicional.
`uv run alembic upgrade head` es idempotente y es lo único que hace falta
tras clonar el repo o desplegar una versión nueva.

---

## 3. Frontend: `frontend/src/`

```
src/
  pages/
    auth/       # LoginPage
    admin/      # AdminLayout, AdminHomePage (dashboards), UsersPage,
                # RolesPage, AccountPage
    pos/        # PosLayout, PosHomePage (TPV)
    NotFoundPage.tsx
  features/     # lógica de cada superficie: auth, dashboards, pos, health,
                # users, roles
  lib/          # cliente HTTP, utilidades compartidas
  routes.tsx    # mapa de rutas de React Router
```

Puntos de diseño a tener en cuenta:

- **Mismo origen que la API en producción**: el build no lleva ninguna URL
  de API embebida (`VITE_API_BASE_URL` vacío) — las peticiones van a
  `/api/...` relativo, igual que en desarrollo el proxy de Vite reenvía
  `/api` a `http://127.0.0.1:8000` (`vite.config.ts`). En producción, quien
  hace ese mismo papel es nginx (`docker/nginx/nginx.conf`) — ver
  `ADMIN_GUIDE.md`.
- **TanStack Query** para todo el estado de servidor (nada de estado de API
  duplicado a mano); **React Hook Form + Zod** para formularios y su
  validación.
- El frontend hoy cubre **login, TPV completo, el panel de dashboards**
  (widgets de fase 16), **usuarios/roles/mi cuenta** (`/admin/access`,
  `/admin/account`), **catálogo** (`/admin/catalog` — productos,
  presentaciones/códigos de barras, categorías de producto, categorías POS
  y unidades) y **precios** (`/admin/pricing` — impuestos y la fórmula del
  PVP; todo añadido tras el cierre de las 22 fases). Compras/inventario/
  lotes/devoluciones/tickets/notificaciones siguen sin pantalla propia —
  se opera contra la API (Swagger UI en `/api/docs`), documentado en
  `USAGE.md` §3. Añadir esas pantallas es trabajo de frontend puro sobre
  una API que ya existe por completo, mismo patrón que `features/users`/
  `features/roles`/`features/catalog`/`features/pricing`.
  - **Impuestos y margen, con herencia categoría → producto** (pedido
    explícitamente, no parte de las 22 fases): `Tax` (nombre + tasa,
    `app/pricing/models.py`) se asigna a un producto y/o a su categoría
    mediante las tablas de asociación `product_taxes`/`category_taxes` —
    varios pueden aplicar a la vez y se suman (`effective_tax_rate`).
    `ProductCategory.margin_rate` y `Product.margin_rate` son ambos
    anulables — `None` es "sin valor propio, hereda", no "0%"
    (`effective_margin_rate`). La prioridad es siempre la misma: valor
    explícito del producto si lo tiene, si no el de su categoría, si no
    0 — resuelta en un único sitio (`app/pricing/service.py`), nunca
    reimplementada en el router ni en el frontend.
  - **`PricingSettings` — la fórmula del PVP, configurable, una sola para
    toda la tienda** (`pricing_settings`, fila única): el usuario pidió
    poder definir su propia fórmula en un panel en vez de un cálculo fijo
    de margen. Reutiliza el motor de fórmulas ya existente desde la fase 4
    (`app/pricing/formula.py`, AST restringido — regla 12) con las mismas
    cuatro variables, sólo que `tax_rate`/`margin_rate` ahora son los
    *efectivos* (ver punto anterior), no columnas crudas. Un producto con
    su propia `price_formula` la sigue usando en vez de la de la tienda —
    sin cambios ahí. Guardar la fórmula global, o el margen/impuestos de
    una categoría, recalcula en el momento el `list_price` de todos los
    productos afectados que no tengan su propio override (bucle simple,
    con su fila de histórico cada uno — ver `_recompute_category_products`/
    `update_settings`) — no es un valor derivado en la lectura, sigue
    siendo una columna guardada como toda la vida, coherente con
    `product_price_history`.
  - **SKU ya no se teclea**: `ProductCreate.sku` es opcional; si no se
    manda (el caso normal desde el panel), `app.catalog.service.
    create_product` le pone uno («P######» a partir del id de la propia
    fila) después del primer `flush`. Sigue siendo único y obligatorio a
    nivel de columna — sólo cambió quién lo rellena. Ventas, compras,
    inventario, lotes, notificaciones y dashboards lo siguen usando
    exactamente igual que antes, sin ningún cambio en esos módulos.
  - **`Unit`** (`app/catalog/models.py`): lista gestionada para el
    desplegable "unidad base" del alta de producto. Deliberadamente *no*
    es una foreign key desde `Product` — `Product.base_unit_name` sigue
    siendo el mismo `String(20)` de siempre (regla 3, y todo módulo que ya
    lo lee lo sigue leyendo igual); `Unit` sólo alimenta el desplegable y
    mantiene los nombres consistentes, sin ninguna migración que tocara
    los módulos que ya usaban ese campo.
  - `/admin/catalog` sigue el mismo patrón de pestañas que `/admin/access`
    (`CatalogPage.tsx`: barra de pestañas + `<Outlet />`), pero gated de
    una sola vez con `RequirePermission permission="product.read"` en vez
    de `RequireAnyPermission` — las dos pestañas (`ProductsPage`,
    `CategoriesPage`) sólo necesitan lectura para verse; cada acción de
    escritura dentro (crear/editar/desactivar un producto, crear una
    categoría, gestionar categorías POS) se muestra u oculta por su cuenta
    según `hasPermission('product.manage')`/`hasPermission
    ('pos_category.manage')` — dos permisos distintos del backend para dos
    cosas distintas (ver `app/catalog/router.py`).
  - Los campos `NUMERIC(18,6)` (coste, precio, IVA, stock mínimo, factor de
    una presentación) viajan como *string*, nunca como `number` — regla 8
    también en el frontend. `lib/decimal.ts`'s `decimalString()` es el
    validador Zod compartido que lo comprueba en los formularios
    (`features/catalog/CreateProductForm.tsx`,
    `features/catalog/EditProductForm.tsx`,
    `features/catalog/PackagesPanel.tsx`).
  - Editar un producto sólo toca campos de catálogo (nombre, descripción,
    categorías, stock mínimo, lotes/caducidad) — coste/precio/IVA sólo se
    fijan al crearlo; cambiarlos después es responsabilidad exclusiva del
    módulo de precios (todavía sin pantalla), igual que en el backend
    (`ProductUpdate`'s propio docstring en
    `backend/app/catalog/schemas.py`).
  - `/admin/access` es una sola sección con pestañas — `AccessPage`
    (`pages/admin/AccessPage.tsx`) sólo pinta la barra de pestañas y un
    `<Outlet />`; `Usuarios` y `Roles` son rutas hijas (`users`/`roles`)
    que siguen siendo `UsersPage`/`RolesPage` sin cambios. Tres capas de
    guardas en `routes.tsx`, todas convenientes, ninguna la barrera real
    (regla 11 — el backend re-comprueba siempre): `RequireAnyPermission`
    en `/admin/access` (entra con `users.manage` **o** `roles.manage`),
    `RequirePermission` en cada pestaña hija (`users.manage`/
    `roles.manage` a secas), y `AccessPage` sólo pinta el enlace de la
    pestaña que `hasPermission(...)` diga que sí. `/admin/users` y
    `/admin/roles` (las rutas de antes de que esto fuera una sola sección)
    siguen funcionando como redirects a las nuevas, para no romper enlaces
    guardados.
  - `GET /roles`/`GET /permissions` aceptan `users.manage` además de
    `roles.manage` (`require_any_permission`, `app/rbac/dependencies.py`)
    — una razón puramente de frontend: un `MANAGER` sin `roles.manage`
    todavía necesita leer el catálogo de roles para el desplegable de
    `CreateUserForm`. Crear/editar un rol sigue exigiendo `roles.manage`
    a secas.
- `tests/setup.ts` sustituye `<canvas>`/`ResizeObserver` (que jsdom no
  implementa) por dobles — los componentes de gráfico (ECharts) se prueban
  de verdad sólo en Playwright (E2E), no en Vitest.

---

## 4. Cómo extender el sistema

Para añadir un módulo de dominio nuevo, el patrón que siguen los 17 módulos
existentes:

1. Carpeta nueva bajo `backend/app/<dominio>/` con `models.py`,
   `schemas.py`, `service.py`, `router.py`.
2. Migración Alembic (`make db-revision m="..."`) para las tablas nuevas.
3. Registrar el router en `app/api/v1/router.py` (una línea).
4. Tests de integración contra PostgreSQL real en `backend/tests/`
   (`pytest.mark.integration` si necesita infraestructura extra).
5. Si el módulo necesita pantalla propia: `frontend/src/features/<dominio>/`
   + página bajo `pages/admin/` o `pages/pos/`, registrada en `routes.tsx`.
6. Si añade claves de permiso nuevas: migración que las inserte en el
   catálogo (igual que hizo la fase 1), documentarlas en `ADMIN_GUIDE.md`.

Referencia viva de la API completa (todos los endpoints, esquemas de
entrada/salida): `/api/docs` (Swagger UI) o `/api/redoc` sobre cualquier
instancia en marcha — no se duplica aquí porque quedaría desactualizada al
primer cambio.

---

## 5. Tests y calidad

```bash
make lint    # ruff + mypy (backend) · ESLint + Prettier + tsc (frontend)
make test    # pytest (backend, PostgreSQL real) + Vitest (frontend)
make test-e2e  # Playwright, de extremo a extremo, arranca API + frontend
make check   # lint + test + build — lo mismo que corre CI, menos E2E
```

Todo el detalle de cómo sembrar datos de prueba, requisitos de Playwright,
etc. está en el `README.md` raíz. Lecciones de diseño de tests ya aprendidas
(fugas entre tests, recursos compartidos en E2E, `committing_sessionmaker`
vs `session_scope()`...) están documentadas donde importan: en los propios
tests y en los docstrings de los módulos que las motivaron.
