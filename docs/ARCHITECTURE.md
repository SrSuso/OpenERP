# Arquitectura y referencia técnica

Este documento describe el sistema actual. No es un manual de operación ni un
registro cronológico. Para producción consulta [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md);
para tareas de interfaz, [`USER_GUIDE.md`](USER_GUIDE.md). El orden histórico de
implementación se conserva, claramente separado, en [`PHASES.md`](PHASES.md).

## 1. Vista general

OpenERP es un monolito modular con una única base PostgreSQL:

```text
Navegador
   ↓ HTTPS
Nginx ── SPA React
   ↓ /api/v1
FastAPI ── PostgreSQL
                ↑
Worker SMTP ── outbox
```

Los límites de dominio viven dentro del código, no en servicios de red. Esto
permite que una venta confirme pago, stock, histórico, auditoría e idempotencia
en una sola transacción.

| Capa | Responsabilidad |
| --- | --- |
| React | Navegación, formularios, estado remoto y experiencia TPV/panel. |
| FastAPI | Autenticación, autorización, validación y API de dominios. |
| SQLAlchemy/PostgreSQL | Transacciones, locks, constraints e histórico. |
| Alembic | Evolución reproducible del esquema y datos de referencia. |
| Worker | Entrega SMTP fuera de las peticiones HTTP. |
| Nginx | TLS, SPA, proxy `/api/v1`, cabeceras y superficie pública. |

## 2. Backend

### 2.1. Organización

Cada dominio se encuentra bajo `backend/app/<dominio>/` y utiliza sólo las
piezas necesarias:

```text
router.py       límite HTTP y permisos
schemas.py      entrada/salida Pydantic
service.py      reglas de negocio
models.py       persistencia SQLAlchemy
presenters.py   proyección de respuesta, cuando se necesita
repository.py   consultas complejas, cuando se necesita
```

Dominios actuales:

| Módulo | Responsabilidad |
| --- | --- |
| `auth`, `users`, `rbac` | Login, sesiones, cuentas, roles y permisos. |
| `audit` | Traza inmutable de acciones sensibles. |
| `catalog`, `pricing` | Productos, categorías, presentaciones, impuestos y precios. |
| `suppliers`, `purchasing` | Proveedores, pedidos y recepciones. |
| `inventory`, `lots` | Ledger, saldos, almacenes, ubicaciones, lotes y FEFO. |
| `pos`, `sales` | Terminales, borradores, checkout, pagos y cierres Z. |
| `returns` | Reembolso y retorno físico independientes. |
| `tickets` | Plantillas versionadas y tickets congelados. |
| `dashboards`, `reports` | Métricas y consultas desde listas blancas. |
| `notifications`, `jobs` | Reglas, incidencias y outbox SMTP. |
| `settings` | Registro de configuración funcional de tienda. |
| `api`, `core`, `db` | Ensamblado HTTP, configuración transversal y sesiones. |

`backend/app/api/v1/router.py` agrega los routers. `backend/app/db/registry.py`
importa todos los modelos para que Alembic vea un único metadata.

### 2.2. Límite transaccional

La dependencia de sesión tiene alcance de función. El ciclo mutante real es:

```text
Request
  ↓
Session
  ↓
Business logic / flush
  ↓
COMMIT PostgreSQL
  ↓
Response HTTP
  ↓
Close session
```

El límite exterior confirma o revierte la transacción; los servicios usan
`flush()` para obtener IDs o adelantar constraints, pero normalmente no se
apropian del commit global. Un error de commit impide el 2xx, ejecuta rollback y
se traduce sin filtrar detalles de PostgreSQL.

### 2.3. Concurrencia e idempotencia

Los agregados mutables se bloquean en orden estable con `SELECT FOR UPDATE`:

- checkout: clave idempotente, corte contable del almacén, venta, terminal y
  grupos de stock;
- recepción: pedido y grupos de producto/stock;
- devolución: venta y líneas antes de calcular límites económicos/físicos;
- cierre Z: ámbito de almacén y operaciones incluidas en el corte;
- plantillas: ámbito global de plantilla activa y revisión.

Las claves idempotentes protegen reintentos de checkout, salidas FEFO,
recepciones, devoluciones y cierres Z. No sustituyen los locks: una evita
repetir la misma intención; los otros serializan intenciones distintas que
compiten por el mismo agregado.

### 2.4. Inventario

`stock_movements` es la fuente histórica. `stock_balance` es una proyección
reconstruible que se actualiza en la misma transacción. Nunca se corrige un
saldo sin crear el movimiento correspondiente.

Todas las cantidades se convierten a unidad base. Un producto puede heredar de
su categoría si controla existencias; los productos sin control no comprueban
ni mueven stock en venta/devolución. Los productos trazados conservan control
de lotes y una salida automática usa FEFO.

Las invariantes de no negatividad se validan bajo lock. La opción funcional
`sales.allow_negative_stock` sólo relaja productos sin lotes.

### 2.5. Histórico comercial

Ventas y compras guardan los datos relevantes de producto, presentación,
factor, precio, coste e impuestos. Al completar una venta se congelan también
terminal y cajero efectivo. Cambios posteriores en catálogo, usuarios o
terminales no reinterpretan el histórico.

Devoluciones mantienen acumuladores separados por línea:

- cantidad económicamente reembolsada;
- cantidad físicamente retornada.

Sólo una cantidad económica crea un `Refund COMPLETED`; sólo una cantidad
física controlada crea movimiento de entrada. El importe procede del snapshot
de la venta.

Los tickets se renderizan una vez y conservan `rendered_text`. Reimprimir no
vuelve a consultar la plantilla activa. Sólo puede existir una plantilla
activa globalmente y editar crea una revisión nueva.

### 2.6. Hora comercial

Los timestamps persistidos son instantes timezone-aware. `business.timezone`
es una opción funcional IANA usada al representar y agrupar ventas, tickets,
dashboards, informes, devoluciones, recepciones, auditoría y avisos.

Cambiarla no reescribe instantes; modifica su representación y puede cambiar la
fecha comercial de operaciones cercanas a medianoche.

### 2.7. Autenticación y permisos

La sesión es server-side y revocable. La cookie contiene un token opaco cuyo
hash se guarda en PostgreSQL. Las sesiones pueden revocarse individualmente y
se revocan al desactivar una cuenta o restablecer su contraseña.

RBAC sigue `usuario → rol → permisos`. El frontend oculta rutas por comodidad,
pero todos los endpoints vuelven a exigir permisos. Las políticas impiden:

- asignar un rol con permisos que el actor no posee;
- modificar usuarios fuera de la autoridad del actor;
- eliminar el último administrador activo recuperable;
- saltarse el cambio obligatorio tras un reset administrativo.

Los roles `ADMIN`, `MANAGER` y `CASHIER` son valores iniciales, no lógica
hardcodeada de autorización.

### 2.8. Dashboards e informes

Cada dashboard tiene `owner_user_id`. Todas las lecturas y mutaciones filtran
por el usuario autenticado; un ID ajeno devuelve no encontrado. No hay sharing.

Widgets e informes usan catálogos de métricas, dimensiones y filtros. El
cliente nunca envía SQL ni nombres de columnas arbitrarios. Una definición de
informe guarda la selección validada, no una consulta.

### 2.9. Outbox

Una petición que necesita correo inserta `outbox_messages` dentro de su misma
transacción. Nunca abre SMTP. `python -m app.jobs.worker` reclama filas con
`SKIP LOCKED`, entrega y actualiza el estado. Si SMTP falla, el negocio ya
confirmado no se revierte.

## 3. Configuración

Existen dos fuentes sin solapamiento:

### 3.1. Infraestructura: `app/core/config.py`

`Settings` se comparte entre API, worker, Alembic, bootstrap y scripts. Lee
`OPENERP_*`; cualquier campo admite `OPENERP_<CAMPO>_FILE`, que precede a la
variable directa. Incluye:

- URL/pool de PostgreSQL;
- CORS, cookies y sesiones;
- bootstrap;
- SMTP y destinatario operativo;
- rate limit;
- logging, entorno y proxy confiable.

Estos valores nunca se leen de la tabla `settings` ni se editan en React.
Producción rechaza la URL local por defecto y un CORS no vacío.

### 3.2. Tienda: `app/settings/registry.py`

El registro declara tipo, etiqueta, grupo, ayuda, límites y valor por defecto de
opciones funcionales. PostgreSQL sólo persiste overrides. La UI se genera a
partir de ese catálogo.

Incluye `business.timezone`, preferencias POS, reglas de venta/catálogo,
avisos y apariencia. No admite database URL, SMTP, CORS, pool, cookies,
bootstrap, rate limit ni claves `server.*`.

## 4. Frontend

`frontend/src/routes.tsx` es el mapa canónico. Las pantallas actuales son:

| Ruta | Pantalla | Permiso de entrada |
| --- | --- | --- |
| `/login` | Inicio de sesión | público |
| `/change-password` | Cambio obligatorio | autenticado y marcado |
| `/pos` | TPV | `pos.access` |
| `/admin` | Dashboard propio | `admin.access` + permisos dashboard para datos |
| `/admin/account` | Contraseña y sesiones propias | `admin.access` |
| `/admin/access/users` | Usuarios | `users.manage` |
| `/admin/access/roles` | Roles | `roles.manage` |
| `/admin/inventory/products` | Productos | `product.read` |
| `/admin/inventory/categories` | Categorías y unidades | `product.read` |
| `/admin/inventory/lots` | Lotes/FEFO | `lot.read` |
| `/admin/inventory/balances` | Saldos/ajustes/transferencias | `inventory.read` |
| `/admin/inventory/movements` | Movimientos | `inventory.read` |
| `/admin/inventory/warehouses` | Almacenes/ubicaciones | `inventory.read` |
| `/admin/inventory/terminals` | Terminales POS | `inventory.manage` |
| `/admin/pricing` | Impuestos y fórmula | `pricing.manage` |
| `/admin/suppliers` | Proveedores | `supplier.read` |
| `/admin/purchasing` | Compras y recepciones | `purchase.read` |
| `/admin/sales` | Ventas/reimpresión | `sale.read` |
| `/admin/z-reports` | Cierres Z | `sale.read` |
| `/admin/returns` | Devoluciones | `return.read` |
| `/admin/reports` | Constructor de informes | `report.read` |
| `/admin/ticket-templates` | Plantillas | `ticket.manage` |
| `/admin/notifications` | Reglas e incidencias | `notification.read` |
| `/admin/outbox` | Correo encolado | `job.read` |
| `/admin/settings` | Configuración funcional | `settings.read` |
| `/admin/audit-log` | Auditoría | `audit.read` |

Rutas antiguas de catálogo, lotes, usuarios y roles son redirects de
compatibilidad, no rutas que deban documentarse para uso normal.

TanStack Query gestiona el estado remoto. React Hook Form y Zod adelantan
validaciones, pero el backend sigue siendo autoritativo. Los importes y
cantidades `NUMERIC` viajan como strings para no introducir `float`.

El TPV persiste sólo la identidad del terminal en `localStorage`; usuario,
borradores y operaciones viven en el servidor. El catálogo se actualiza por
una versión ligera periódica, cambio de foco y `BroadcastChannel`, sin alterar
el borrador activo.

## 5. API y perímetro

En desarrollo/test, Swagger está en `/api/docs`, ReDoc en `/api/redoc` y el
OpenAPI HTTP en `/api/openapi.json`. Son referencia técnica **DEVELOPMENT
ONLY**. En producción FastAPI no registra esas rutas.

Nginx es la única entrada de producción:

```text
/                 SPA
/api/v1/...       FastAPI
/api/* restante   404
docs y health     no públicos
```

FastAPI no publica puerto en el host. Nginx sobrescribe `X-Forwarded-For` y
Uvicorn sólo confía en su IP interna exacta. La IP normalizada alimenta sesión,
auditoría, logs y rate limit. La política de cabeceras pertenece a Nginx para
cubrir también SPA, assets y errores.

Producción usa un proceso Uvicorn. El rate limiter de login es local, acotado y
se reinicia con el proceso; desplegar varias réplicas requeriría rediseñar esa
pieza, no simplemente aumentar workers.

## 6. Migraciones

Alembic es la única vía de evolución del esquema. Las migraciones incluyen los
datos de referencia necesarios para que una base nueva en `head` sea utilizable.
Cada migración debe importar su conjunto histórico congelado de permisos, no el
agregado runtime actual.

El despliegue ejecuta migraciones sólo con API y worker parados, después de un
backup verificado. No se utiliza downgrade automático para rollback: se restaura
el backup en una base nueva y se selecciona la imagen compatible.

## 7. Tests

- pytest unitario sin PostgreSQL para funciones puras.
- pytest de integración contra PostgreSQL real para persistencia y locks.
- Vitest/Testing Library para componentes y contratos frontend.
- Playwright para flujos visibles completos.

La política FAST/DOMAIN/FULL y los comandos vigentes están centralizados en
[`TESTING.md`](TESTING.md). Las pruebas de migración completas se reservan para
cambios de esquema, CI y release.

## 8. Extender el sistema

Para un dominio nuevo:

1. añade el paquete backend y sus permisos;
2. registra modelos y router;
3. crea migración sólo si cambia el esquema;
4. añade primero pruebas unitarias/integración dirigidas;
5. si existe uso de interfaz, añade feature, página, ruta y navegación con sus
   guardas;
6. actualiza `USER_GUIDE.md` sólo si la tarea está disponible en UI y
   `ADMIN_GUIDE.md` sólo si cambia la operación.

No presentes un endpoint interno como funcionalidad de usuario y no conviertas
Swagger en un procedimiento administrativo.
