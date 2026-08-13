# Guía de uso

Cómo poner en marcha OpenERP y usarlo, tal y como está hoy (fases 0 y 1:
bootstrap + autenticación/RBAC; fases 12/13/15: el TPV, cobrar en él e
imprimir el ticket; fase 16: el panel de administración). Las fases
intermedias (2–11, 14) son sólo API, documentada en `/api/docs` — no
añaden nada que un usuario final "use" directamente, así que no tienen
sección propia aquí. Cada fase que sí la necesite añade la suya, sin
reescribir las anteriores.

---

## 1. Puesta en marcha

### 1.1. Requisitos

- Python 3.13+ y [uv](https://docs.astral.sh/uv/).
- Node.js 20.19+ (recomendado 22) — sólo para el frontend.
- Docker con Compose, **o**, si no hay Docker, los scripts *rootless* de
  `scripts/` (no necesitan privilegios de administrador).

### 1.2. Infraestructura (PostgreSQL + Mailpit)

Con Docker:

```bash
docker compose -f docker/compose.yml up -d --wait
```

Sin Docker:

```bash
./scripts/dev-postgres.sh start   # PostgreSQL 17 en 127.0.0.1:55432
./scripts/dev-mailpit.sh start    # Mailpit: SMTP 1025, UI http://127.0.0.1:8025
source scripts/env.sh             # deja OPENERP_DATABASE_URL apuntando al puerto correcto
```

### 1.3. Dependencias y base de datos

```bash
cp .env.example .env              # ajusta OPENERP_DATABASE_URL si usas el puerto rootless (55432)

cd backend  && uv sync     && cd ..
cd frontend && npm install && cd ..

cd backend && uv run alembic upgrade head && cd ..
```

`alembic upgrade head` deja la base de datos con las tablas de auth/RBAC ya
creadas **y** con los roles `ADMIN`, `MANAGER` y `CASHIER` sembrados junto a
su catálogo de permisos — son datos de referencia, no secretos, así que
vienen en la propia migración. Ningún usuario se crea todavía: eso es el
paso siguiente.

### 1.4. Crear el primer administrador

No hay registro público — los usuarios los da de alta un administrador desde
dentro de la aplicación, así que hace falta crear el primero a mano una vez
por entorno:

```bash
cd backend && uv run python -m app.auth.bootstrap
# admin email: admin@tu-tienda.example
# admin password: ********
# confirm password: ********
```

También puedes usar `make bootstrap-admin` desde la raíz, o pasar las
credenciales por variables de entorno para un arranque no interactivo
(útil en despliegues):

```bash
OPENERP_BOOTSTRAP_ADMIN_EMAIL=admin@tu-tienda.example \
OPENERP_BOOTSTRAP_ADMIN_PASSWORD='una contraseña de verdad' \
  uv run python -m app.auth.bootstrap
```

Es idempotente: si el email ya existe, no hace nada y termina con éxito, así
que es seguro dejarlo en un script de despliegue que se ejecuta en cada
release.

### 1.5. Arrancar

```bash
# terminal 1 — API
cd backend && uv run uvicorn app.main:app --reload --port 8000

# terminal 2 — frontend
cd frontend && npm run dev
```

El `Makefile` de la raíz agrupa todo lo anterior — `make help` lista los
objetivos (`make up`, `make install`, `make db-upgrade`,
`make bootstrap-admin`, `make dev-api`, `make dev-web`, `make test`...).

---

## 2. Iniciar sesión

| Superficie | URL |
| --- | --- |
| Panel de administración | <http://127.0.0.1:5173/admin> |
| Punto de venta (TPV) | <http://127.0.0.1:5173/pos> |
| Documentación interactiva de la API | <http://127.0.0.1:8000/api/docs> |

Al entrar a cualquiera de las dos superficies sin sesión, se redirige a
`/login`. Con las credenciales del administrador creado en el paso 1.4:

- Un usuario con `admin.access` (rol `ADMIN` o `MANAGER`) entra en
  `/admin`.
- Un usuario con sólo `pos.access` (rol `CASHIER`) sólo puede entrar en
  `/pos` — si intenta ir a `/admin` es redirigido de vuelta, y aunque
  llamara a la API directamente recibiría `403 permission_denied`.

La sesión vive en una cookie `openerp_session` (httpOnly, no accesible desde
JavaScript). Se renueva sola mientras hay actividad y expira a los 30 días
de inactividad (`OPENERP_SESSION_TTL_DAYS`). El botón **Salir** /
**Cerrar sesión** de cada superficie revoca la sesión actual en el servidor,
no sólo borra la cookie.

Si necesitas ver o cerrar otras sesiones abiertas del mismo usuario (por
ejemplo, un terminal de TPV en el que alguien se dejó la sesión iniciada):

```bash
curl -b cookies.txt http://127.0.0.1:8000/api/v1/auth/sessions
curl -b cookies.txt -X DELETE http://127.0.0.1:8000/api/v1/auth/sessions/<id>
```

---

## 3. Gestionar usuarios y roles

También puede gestionarse por API con `curl` o, en desarrollo, desde
`/api/docs` (Swagger UI, autenticado con la sesión del navegador si abres esa
URL ya logueado en `/admin`). Producción no publica Swagger/ReDoc/OpenAPI.

Todo lo que sigue requiere `users.manage` (`ADMIN` o `MANAGER`) o, para
roles, `roles.manage` (sólo `ADMIN`).

### 3.1. Dar de alta un cajero

```bash
# 1. averigua el id del rol CASHIER
curl -b cookies.txt http://127.0.0.1:8000/api/v1/roles

# 2. crea el usuario
curl -b cookies.txt -X POST http://127.0.0.1:8000/api/v1/users \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "cajero1@tu-tienda.example",
    "full_name": "Cajero Uno",
    "password": "una contraseña de al menos 8 caracteres",
    "role_id": 3
  }'
```

### 3.2. Desactivar un usuario

Los usuarios nunca se borran (regla 14) — se desactivan, y desde ese momento
no pueden iniciar sesión aunque conserven todo su histórico:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:8000/api/v1/users/<id>/deactivate
```

### 3.3. Crear un rol a medida y asignarle permisos

```bash
curl -b cookies.txt -X POST http://127.0.0.1:8000/api/v1/roles \
  -H 'Content-Type: application/json' \
  -d '{"name": "AUDITOR", "description": "Sólo consulta."}'

curl -b cookies.txt -X PATCH http://127.0.0.1:8000/api/v1/roles/<id>/permissions \
  -H 'Content-Type: application/json' \
  -d '{"permission_keys": ["admin.access"]}'
```

El catálogo completo de claves de permiso disponibles está en
`GET /permissions` (hoy: `admin.access`, `pos.access`, `users.manage`,
`roles.manage` — cada fase futura añade las suyas).

### 3.4. Cambiar tu propia contraseña

Cualquier usuario autenticado, sin necesitar `users.manage`:

```bash
curl -b cookies.txt -X POST http://127.0.0.1:8000/api/v1/users/me/password \
  -H 'Content-Type: application/json' \
  -d '{"current_password": "...", "new_password": "..."}'
```

---

## 4. Verificar que todo funciona

```bash
make test-backend     # pytest sobre PostgreSQL real (backend/tests)
make test-frontend     # Vitest + React Testing Library
make lint               # ruff + mypy + ESLint + Prettier + tsc
```

Playwright necesita, además, que existan los usuarios fijos con los que
inician sesión las specs (`tests/e2e/specs/*.spec.ts`) — no hay
auto-registro, así que hace falta sembrarlos una vez por base de datos:

```bash
make db-upgrade                                            # aplica la migración de fase 1 si falta
OPENERP_DATABASE_URL=postgresql://openerp:openerp@127.0.0.1:5432/openerp_e2e \
  make seed-e2e                                             # crea admin/cajero de prueba, idempotente
OPENERP_DATABASE_URL=postgresql://openerp:openerp@127.0.0.1:5432/openerp_e2e \
  make test-e2e                                             # Playwright (levanta API + frontend)
```

Usa una base de datos separada de la de desarrollo (aquí `openerp_e2e`) para
no mezclar usuarios de prueba con los tuyos; créala con
`uv run python -m scripts.devdb create --database openerp_e2e` desde
`backend/` antes del primer `make db-upgrade`. Las credenciales por defecto
son `e2e-admin@example.com` / `e2e-cashier@example.com` (contraseñas en
`backend/scripts/seed_e2e_users.py`), o las que fijes en
`E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`/`E2E_CASHIER_EMAIL`/`E2E_CASHIER_PASSWORD`.
Además, desde la fase 12, `make seed-e2e-catalog` siembra una categoría POS,
un par de productos con su stock y (desde la fase 15) una plantilla de
ticket activa (idempotente, ver `backend/scripts/seed_e2e_catalog.py`) —
sin esto el TPV cargaría, pero la rejilla estaría vacía y cobrar/imprimir
fallaría. El job de CI hace
exactamente esto (ver `.github/workflows/ci.yml`).

o los comandos equivalentes por partes, como en el README.

---

## 5. Roles y permisos de referencia (fase 1)

| Rol | Permisos por defecto | Pensado para |
| --- | --- | --- |
| `ADMIN` | todos | Dueño/gerencia con acceso total. |
| `MANAGER` | `admin.access`, `users.manage` | Encargado de tienda: entra al panel y gestiona personal, pero no puede tocar la estructura de roles/permisos. |
| `CASHIER` | `pos.access` | Cajero: sólo el TPV, sin acceso al panel de administración. |

Son el punto de partida sembrado por la migración, no una lista cerrada:
cualquier `ADMIN` puede crear roles nuevos o cambiar los permisos de estos
tres desde `PATCH /roles/{id}/permissions`.

---

## 6. Usar el TPV (fases 12/13/15)

`/pos` es una pantalla táctil de pantalla completa, pensada para un cajero
(rol `CASHIER`, sólo necesita `pos.access`).

Para verla con productos de verdad en desarrollo, siembra un catálogo mínimo
(idempotente, los mismos datos que usa la suite E2E):

```bash
make seed-e2e-catalog
```

Al entrar a `/pos`:

- Se reanuda automáticamente la venta `DRAFT` que ya tuviera abierta este
  almacén (recargar la página no la pierde), o se abre una nueva si no
  había ninguna.
- Tocar un producto de la rejilla añade una unidad de su presentación base
  al ticket; las pestañas de arriba filtran por categoría POS (fase 10).
- El campo de código de barras (pensado también para un lector físico, que
  escribe el código y pulsa "Intro") añade la línea correspondiente sin
  pasar por la rejilla.
- **Cancelar venta** cancela el ticket actual (irreversible) y abre uno
  nuevo automáticamente — no hay forma de "vaciar" un ticket salvo quitando
  línea a línea o cancelándolo entero.
- **Cobrar** (fase 13) pide el método (efectivo/tarjeta) y el importe —
  editable en efectivo, con el cambio calculado en vivo; exacto en tarjeta.
  Confirmar comprueba stock real, mueve el inventario, cierra la venta y
  muestra un recibo en pantalla con el cambio a entregar; al continuar se
  abre automáticamente un ticket nuevo. Si no hay stock suficiente, o el
  importe no cubre el total, se rechaza y el ticket sigue abierto tal cual
  estaba — nada queda a medias.
- **Imprimir ticket** (fase 15), desde la propia confirmación de cobro,
  genera (o recupera, si ya se generó) el recibo de 58/80mm y abre el
  diálogo de impresión del navegador. Hace falta una plantilla activa
  (`make seed-e2e-catalog` siembra una por defecto) — sin ella, el botón
  falla con un error explícito en vez de imprimir cualquier cosa.

---

## 7. El panel de administración (fase 16)

`/admin` deja de ser un simple chequeo de estado: al entrar, se crea (la
primera vez) o se muestra "Mi panel" — un panel con los widgets que se
hayan añadido. **Añadir widget** deja elegir una de cuatro métricas (ventas
por día, productos más vendidos, valor de inventario, productos bajo
mínimo), con sus propios filtros (rango de fechas, almacén); cada widget
consulta sus datos en el momento, nunca una caché. Quitar un widget lo
retira sin más — no hay edición todavía, sólo añadir/quitar.
