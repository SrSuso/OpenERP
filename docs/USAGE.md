# Entorno local de desarrollo

> **DEVELOPMENT ONLY.** Este documento prepara una copia local para desarrollar
> y depurar. La operación de una instalación real está exclusivamente en
> [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md); el uso funcional de la interfaz está en
> [`USER_GUIDE.md`](USER_GUIDE.md).

---

## 1. Requisitos

- Python 3.13 o posterior y [uv](https://docs.astral.sh/uv/).
- Node.js 20.19 o posterior, recomendado 22.
- Docker con Compose o los scripts rootless de `scripts/`.

Desde la raíz del repositorio, `make help` muestra los comandos disponibles.

## 2. Instalar dependencias

```bash
make install
```

Este target instala backend, frontend y el proyecto Playwright de la raíz. Si
sólo se trabaja en una capa están disponibles `make install-backend` y
`make install-frontend`.

## 3. Levantar PostgreSQL y Mailpit

Con Docker:

```bash
make up
```

Levanta exclusivamente infraestructura de desarrollo:

- PostgreSQL en `127.0.0.1:5432`.
- Mailpit SMTP en `127.0.0.1:1025` y UI en `127.0.0.1:8025`.

Sin Docker:

```bash
make up-rootless
source scripts/env.sh
```

Los scripts rootless descargan PostgreSQL local y lo sirven en
`127.0.0.1:55432`; `scripts/env.sh` exporta la URL correspondiente para esa
terminal.

Para detener la infraestructura usa `make down` o `make down-rootless`, según
el modo elegido.

## 4. Configurar y migrar la base local

```bash
cp .env.example .env
make db-create
make db-upgrade
```

Revisa `.env` si usas otro puerto. Las credenciales que trae `.env.example`
son sólo para el PostgreSQL local de desarrollo y no deben copiarse a
producción.

Para reiniciar voluntariamente todos los datos locales existe
`make db-reset`. Es destructivo para la base configurada y no debe utilizarse
contra una instalación real.

## 5. Crear el primer usuario local

No hay autorregistro. Ejecuta:

```bash
make bootstrap-admin
```

El comando solicita email y contraseña sin imprimir la contraseña. Es
idempotente para el mismo email. Los demás usuarios se crean después desde
**Panel → Usuarios y roles**.

## 6. Arrancar la aplicación

En terminales separadas:

```bash
make dev-api
make dev-web
make dev-worker
```

El worker es opcional para navegar y cobrar, pero necesario para que los
correos encolados lleguen a Mailpit.

| Superficie local | Dirección |
| --- | --- |
| Panel | <http://127.0.0.1:5173/admin> |
| TPV | <http://127.0.0.1:5173/pos> |
| Mailpit | <http://127.0.0.1:8025> |

### Referencia API para desarrollo

> **DEVELOPMENT ONLY.** FastAPI publica Swagger en
> <http://127.0.0.1:8000/api/docs>, ReDoc en `/api/redoc` y el esquema en
> `/api/openapi.json` únicamente en `development` y `test`. Sirven para
> inspección técnica, no para administrar una tienda. Producción no registra
> ninguna de esas rutas.

## 7. Datos de demostración y E2E

Para poblar el TPV local con un catálogo mínimo:

```bash
make seed-e2e-catalog
```

El target es idempotente, pero inserta datos de prueba; no debe apuntarse a una
base real.

Playwright utiliza una base separada. La preparación y los comandos dirigidos
están en [`TESTING.md`](TESTING.md). Las variables `E2E_*` permiten sustituir
las credenciales fijas de test sin escribirlas en la documentación.

## 8. Pruebas y calidad

Durante desarrollo se ejecuta primero el caso exacto:

```bash
make test-fast TESTS="tests/test_sales.py::test_caso"
make test-frontend-fast TESTS="src/features/pos/Cart.test.tsx"
make lint-frontend-fast FILES="src/features/pos/Cart.tsx"
```

Después se escala a un dominio y sólo al final a las puertas completas. La
política FAST/DOMAIN/FULL y todos los targets reales están en
[`TESTING.md`](TESTING.md).

## 9. Diferencias deliberadas con producción

| Desarrollo | Producción |
| --- | --- |
| Vite y Uvicorn en puertos locales | SPA y API sólo detrás de Nginx HTTPS |
| CORS explícito para Vite | CORS vacío, mismo origen |
| Cookie no `Secure` sobre HTTP local | Cookie `Secure`, `HttpOnly`, `SameSite=Lax` |
| Swagger/ReDoc/OpenAPI HTTP disponibles | Documentación HTTP desactivada |
| Mailpit local | Relay SMTP corporativo por entorno |
| Credenciales locales conocidas | Secretos propios mediante entorno o `*_FILE` |

No utilices este documento como procedimiento alternativo de despliegue.
