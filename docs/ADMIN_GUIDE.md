# Manual de administración

Para quien instala, despliega y opera OpenERP — no hace falta saber Python
ni React, pero sí manejarse con la línea de comandos de un servidor Linux.
Para cómo está construido el código, ver [`ARCHITECTURE.md`](ARCHITECTURE.md).
Para cómo usan la aplicación cajeros y encargados, ver
[`USER_GUIDE.md`](USER_GUIDE.md).

---

## 1. Antes de empezar

### 1.1. Qué hace falta

- Un servidor Linux en la red interna de la empresa, con **Docker** y el
  plugin **Docker Compose** instalados, y acceso por SSH.
- Un nombre u IP por el que los equipos de la oficina vayan a llegar a él
  (por ejemplo `openerp.miempresa.local` o `10.0.4.12`).
- Puertos **80** y **443** libres en ese servidor (el 443 es el que se usa
  de verdad; el 80 sólo redirige a HTTPS).
- `git` para traer el código, u otra forma de copiar el repositorio al
  servidor.

### 1.2. Qué se despliega

Cinco piezas, cada una su propio contenedor, definidas en
[`docker/compose.prod.yml`](../docker/compose.prod.yml):

| Servicio | Qué es | Accesible desde la LAN |
| --- | --- | --- |
| `web` | nginx: sirve el frontend compilado y hace de proxy HTTPS hacia `api` | Sí — puertos 80/443 |
| `api` | El backend (FastAPI/uvicorn) | No directamente — sólo a través de `web` |
| `worker` | Envía los correos encolados (incidencias, etc.) | No — no expone ningún puerto |
| `migrate` | Aplica las migraciones y termina; no es un servicio permanente | No |
| `postgres` | La base de datos | No — sólo `127.0.0.1` del propio servidor (backups) |
Esto es un stack **independiente** del `docker/compose.yml` de desarrollo
(ese sólo levanta PostgreSQL y Mailpit para trabajar en el código a mano).

---

## 2. Primer despliegue

Todo desde la raíz del repo, en el servidor.

### 2.1. Traer el código

```bash
git clone <url-del-repositorio> openerp
cd openerp
```

### 2.2. Certificado HTTPS interno

El backend exige HTTPS en producción — la cookie de sesión lleva el
atributo `Secure` en cuanto `OPENERP_ENVIRONMENT=production`
(`backend/app/core/config.py`, `session_cookie_secure`), así que sin TLS el
navegador nunca la reenvía y el login no llega a funcionar. Dos formas de
tener un certificado:

**a) Certificado autofirmado (el caso más común en una red interna sin CA propia):**

```bash
make prod-cert host=openerp.miempresa.local
# o, si se accede por IP:
make prod-cert host=10.0.4.12
```

Genera `deploy/certs/fullchain.pem` y `deploy/certs/privkey.pem`, válido 825
días. Los navegadores de la red interna mostrarán una advertencia de
certificado no confiable hasta que lo importes como autoridad de confianza:

- **Windows**: doble clic en `fullchain.pem` → *Instalar certificado* →
  *Equipo local* → *Colocar todos los certificados en el siguiente
  almacén* → *Entidades de certificación raíz de confianza*.
- **macOS**: Llavero de acceso → arrastrar `fullchain.pem` → doble clic →
  *Confiar* → *Siempre confiar*.
- **Linux (Debian/Ubuntu)**: copiar a
  `/usr/local/share/ca-certificates/openerp.crt` y `sudo update-ca-certificates`.
- **Chrome/Edge en Linux**: importarlo también en el almacén NSS
  (`certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n openerp -i fullchain.pem`).

No normalices ni documentes como rutina «continuar de todos modos» ante una
advertencia TLS. Importa el certificado o usa la CA interna antes de anunciar
la instalación: el equipo no debe acostumbrarse a ignorar avisos de identidad.

**b) Certificado de una CA interna de la empresa (recomendado si ya existe):**
pide un certificado+clave para el hostname del servidor a quien gestione
esa CA y colócalos directamente en `deploy/certs/fullchain.pem` y
`deploy/certs/privkey.pem`. Como todos los equipos del dominio ya confían
en esa CA, nadie tiene que importar nada a mano. `scripts/gen-internal-cert.sh`
no hace falta en ese caso.

### 2.3. Variables de entorno de producción

```bash
cp .env.production.example .env.production
```

Edita `.env.production` (nunca se commitea — está en `.gitignore`):

- `POSTGRES_PASSWORD` y la contraseña dentro de `OPENERP_DATABASE_URL`
  (deben coincidir) — pon una contraseña larga y aleatoria, no la de
  ejemplo.
- Deja `OPENERP_CORS_ORIGINS` vacío: SPA y API comparten origen en producción.
- Mantén `OPENERP_TRUSTED_PROXY_IP` dentro de `OPENERP_BACKEND_SUBNET`. Sólo
  hace falta cambiar ambos si `172.30.0.0/24` colisiona con una red del host.
- Configura `OPENERP_SMTP_*` con el relay corporativo si vas a enviar avisos;
  Mailpit queda exclusivamente en desarrollo (§7).
- Para no poner un secreto directamente en el entorno, monta un fichero y usa
  `OPENERP_DATABASE_URL_FILE`, `OPENERP_SMTP_PASSWORD_FILE`, etc. Cualquier
  campo admite la forma genérica `OPENERP_<CAMPO>_FILE`, que tiene precedencia
  sobre la variable directa. Compose debe montar ese fichero en `api`,
  `worker` y `migrate` cuando el campo sea compartido.
- El resto de valores por defecto sirven para arrancar; el fichero
  documenta cada uno inline. Detalle de qué es cada variable en
  [`ARCHITECTURE.md`](ARCHITECTURE.md#3-configuración).

Estos son parámetros de proceso: no aparecen en el panel y cambiar una fila
de `settings` no puede alterarlos. Reinicia API y worker tras cambiarlos;
Alembic y bootstrap leerán el valor nuevo en su siguiente ejecución.

### 2.4. Construir y arrancar

```bash
make prod-build     # construye las imágenes propias de backend y frontend
make prod-up        # con escritores aún offline: levanta, migra y arranca el stack
```

`make prod-up` se reserva para instalación inicial o un stack completamente
parado: comprueba que API/worker no estén activos y espera a que los
healthchecks pasen (`--wait`). Para actualizar usa siempre `prod-deploy`.
Compruébalo en cualquier momento con:

```bash
make prod-ps
make prod-logs      # Ctrl-C para dejar de seguir
```

### 2.5. Crear el primer administrador

No hay registro público — se crea una vez por instalación. Con
`OPENERP_BOOTSTRAP_ADMIN_EMAIL`/`OPENERP_BOOTSTRAP_ADMIN_PASSWORD` ya puestos
en `.env.production` (la plantilla trae placeholders `CAMBIAR`, §2.3), no
hace falta contestar nada:

```bash
make prod-bootstrap-admin
```

Es idempotente: si ya existe un admin con ese email, no hace nada y termina
bien — seguro de dejar en un procedimiento de despliegue repetible. Si
prefieres no dejar la contraseña inicial en el `.env.production`
(queda en texto plano en el servidor), borra esas dos líneas del fichero
antes de este paso y el comando te la pedirá de forma interactiva en su
lugar.

**Entra y cámbiala de inmediato**: `https://<host>/admin` con el email y la
contraseña de `.env.production` → **Mi cuenta** en el menú lateral →
cambia la contraseña ahí. Mientras no lo hagas, cualquiera con el
`.env.production` tiene
acceso de administrador total.

### 2.6. Verificar

Desde un equipo de la red interna, con el certificado ya importado (§2.2):

- Panel: `https://<host>/admin`
- TPV: `https://<host>/pos`

Las sondas de API no son públicas. Desde el servidor, `make prod-smoke`
comprueba readiness, revisión Alembic y Nginx sin realizar escrituras.

---

## 3. Operación del día a día

| Tarea | Comando |
| --- | --- |
| Ver estado de los servicios | `make prod-ps` |
| Ver logs en vivo | `make prod-logs` |
| Parar el stack (conserva los datos) | `make prod-down` |
| Reiniciar API y worker (tras editar `.env.production`) | `make prod-restart` |
| Desplegar código/migraciones | `make prod-deploy` |

### 3.1. Desplegar una actualización de código

```bash
make prod-deploy          # actualización normal, con backup obligatorio
make prod-deploy force=1  # reconstruye aunque el commit ya esté desplegado
```

No ejecutes `prod-migrate` por separado con la tienda abierta. El script usa
un lock local para impedir dos deploys simultáneos y sigue este orden:

```text
preflight + git pull + build con la versión antigua online
→ mantenimiento ON (nginx devuelve 503)
→ API y worker OFF; comprobación de que ambos pararon
→ backup pre-upgrade obligatorio + checksum + pg_restore --list
→ Alembic con la imagen nueva; comprobación current == head
→ API/web nuevos; health y smoke sin escrituras
→ worker nuevo y dos comprobaciones de proceso separadas
→ mantenimiento OFF
```

El build ocurre antes de parar la tienda. El fichero
`deploy/maintenance/enabled`, montado en nginx, cambia las rutas SPA/API a una
página 503 sin tocar PostgreSQL. No lo borres manualmente hasta completar las
comprobaciones. El smoke sólo consulta readiness, la revisión Alembic y el
health de nginx; no crea ventas ni altera datos.

Los escritores gestionados son `api` (incluido el disparador manual del outbox)
y `worker`; ambos se paran y su estado Docker se inspecciona antes del dump.
Durante la ventana tampoco debe ejecutarse manualmente `bootstrap-admin`,
scripts de seed, otro Alembic ni utilidades que abran `session_scope`: son
escritores externos al Compose persistente y el operador debe mantenerlos fuera
de la ventana. PostgreSQL y nginx permanecen levantados.

La imagen que estaba ejecutándose se etiqueta con el commit anterior antes
del build. Los commits anterior/actual quedan en `deploy/state/`; no se depende
de `latest` para recuperar la versión previa.

Si falla backup, migración, health, smoke o worker, el script vuelve a parar
API/worker, conserva el backup si llegó a crearse y deja mantenimiento activo.
No hace downgrade ni restore automático. Lee el error y aplica §4.3.

---

## 3.2. Perímetro HTTP y confianza en el proxy

La única entrada desde la LAN es Nginx. El firewall debe permitir 80/443 y
SSH sólo desde redes administrativas; no abras 8000 ni 5432. PostgreSQL
publica 5432 únicamente en `127.0.0.1` para backup/restore y FastAPI sólo
declara `expose: 8000` en la red Docker `openerp-prod-backend`.

```text
cliente → Nginx :443
          ├─ /                 → SPA
          ├─ /api/v1/...       → FastAPI
          └─ /api/* restante   → 404 (nunca index.html)
```

`/api/docs`, `/api/redoc`, `/api/openapi.json` y sus variantes sin `/api`
responden 404. Las sondas `/api/v1/health/live` y `ready` también se bloquean
en el perímetro; Docker y `prod-smoke` las consultan directamente dentro del
contenedor. En desarrollo directo, Swagger/ReDoc/OpenAPI siguen disponibles.

Nginx sobrescribe —no concatena— `X-Forwarded-For` con la IP del socket del
cliente. Uvicorn usa un solo proceso y sólo acepta forwarding desde la IP fija
de Nginx (`OPENERP_TRUSTED_PROXY_IP`). Una cabecera enviada directamente a
FastAPI o por un peer distinto no cambia la IP de sesión, auditoría o
rate-limit. Si se coloca otro proxy delante, todos los clientes se verán como
ese proxy hasta configurar explícitamente `set_real_ip_from` para sus IP/CIDR;
no uses confianza global ni `--forwarded-allow-ips=*`.

Nginx emite estos headers en SPA, assets, API, errores y mantenimiento:

| Header | Valor |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=(), payment=(), usb=()` |
| `Strict-Transport-Security` | `max-age=31536000` |

La CSP no permite scripts inline ni `unsafe-eval`. `style-src 'unsafe-inline'`
es la única excepción: React usa estilos calculados para colores/alturas y
ECharts CanvasRenderer posiciona su canvas mediante atributos `style`. Scripts,
API, imágenes y fuentes permanecen same-origin; `data:` sólo se abre para
imágenes. HSTS se emite únicamente en el servidor HTTPS, sin `includeSubDomains`
ni `preload`. El despliegue soportado termina TLS en este Nginx. Si TLS termina
en otro proxy, configura explícitamente esa topología antes de exponerla; no
confíes en un `X-Forwarded-Proto` enviado por el cliente.

Producción exige la lista CORS vacía y falla antes del downtime si una
configuración antigua todavía contiene orígenes. Desarrollo conserva el origen
explícito `http://localhost:5173`. La sesión mantiene cookie
`Secure`, `HttpOnly`, `SameSite=Lax`; el POST cross-site normal no recibe esa
cookie y no se añadió una capa CSRF innecesaria para esta topología same-origin.

## 3.3. Registrar los terminales POS

Antes de abrir el TPV por primera vez, entra en **Inventario → Terminales
POS** y crea cada puesto físico (Caja 1, Caja 2…) asignándolo a su almacén.
El almacén no se puede cambiar después: las ventas conservan el ID del
terminal como histórico. Se puede renombrar o desactivar, pero no borrar.

El navegador pide uno de los terminales activos y guarda la elección
localmente. Cambiar de usuario no cambia de caja. Para elegir otra, pulsa el
nombre del terminal en la cabecera del TPV.

Si se rompe una caja con un borrador pendiente, **no la borres ni esperes que
el borrador se mueva solo**. Desactiva el terminal para impedir más operación
y localiza la venta «Sin cobrar» en **Ventas**: allí permanece visible con el
terminal que la originó. La versión actual no transfiere borradores entre
terminales.

## 3.4. La caja: imprimir el ticket sin cuadro de impresión

Una página web no puede saltarse el cuadro de impresión del navegador.
`window.print()` lo abre siempre, y es una restricción de seguridad
deliberada: si una web pudiera imprimir sola, cualquiera podría vaciarte el
papel. No hay forma de programarlo desde la aplicación.

Lo que sí se puede es arrancar el navegador de la caja en **modo caja**,
donde `window.print()` manda el trabajo directo a la impresora
predeterminada. Según el equipo de la caja:

**Windows** — haz doble clic en `scripts\pos-kiosk.cmd`, o crea un acceso
directo a él con la dirección detrás:

```
pos-kiosk.cmd https://tu-tienda.example
```

Para que arranque solo al encender, pon ese acceso directo en la carpeta
Inicio (tecla Windows + R → `shell:startup`).

**Linux** — `scripts/pos-kiosk.sh https://tu-tienda.example`, y añádelo a
las aplicaciones de inicio de sesión del escritorio.

**macOS** — desde el Terminal:

```bash
open -na "Google Chrome" --args --kiosk-printing \
  --user-data-dir="$HOME/Library/Application Support/openerp-pos-kiosk" \
  --app=https://tu-tienda.example/pos
```

**Firefox**, si es el navegador de la caja: no tiene modo caja, pero sí un
ajuste equivalente. En `about:config`, pon `print.always_print_silent` a
`true`.

### Cómo saber si está funcionando

Cobra una venta de prueba. Si el ticket sale por la impresora **sin que
aparezca ninguna ventana**, está bien. Si sigue apareciendo el cuadro de
impresión, casi siempre es una de estas tres:

- Se abrió el TPV con un Chrome que **ya estaba abierto**. El modo caja se
  decide al arrancar el navegador; el script usa un perfil aparte
  precisamente para arrancar uno nuevo, pero si abres la dirección
  copiándola a una pestaña del Chrome de siempre, no vale.
- El acceso directo perdió el `--kiosk-printing` (pasa al recrearlo a mano).
- Es otro navegador. Edge admite el mismo `--kiosk-printing`; Safari no
  tiene equivalente.

En el equipo de la caja, antes:

1. Pon la impresora de tickets como **predeterminada del sistema**. Es la
   que se usará: el modo caja no pregunta, y por eso no elige.
2. En su controlador, deja configurado el ancho del rollo (58 u 80 mm).
   Los márgenes los quita ya la aplicación (`@page { margin: 0 }`), que es
   lo que evita que el ticket salga partido.

Para que arranque solo al encender, añade el script a las aplicaciones de
inicio de sesión del escritorio.

---

## 4. Backup, restore y rollback

### 4.1. Copia verificada

`make prod-deploy` siempre crea su backup después de parar API/worker. Para
una copia periódica adicional:

```bash
make prod-backup
```

El resultado es `pg_dump --format=custom --no-owner --no-privileges`, con
nombre que incluye base, UTC y commit. El script exige fichero no vacío,
ejecuta `pg_restore --list` y guarda al lado:

- `.sha256`, validado obligatoriamente antes de restaurar;
- `.metadata`, con fecha, base, commit y revisión Alembic.

Directorio `0700`; dump y metadatos `0600`. Se conservan las 14 copias locales
más recientes por defecto (`OPENERP_BACKUP_KEEP_COUNT`), sin seguir symlinks y
sin borrar la recién creada.

### 4.2. Restore por desastre: siempre a una base nueva

Primero activa mantenimiento y detén/verifica escritores:

```bash
mkdir -p deploy/maintenance && touch deploy/maintenance/enabled
make prod-stop-writers
make prod-writers-stopped
make prod-restore f=backups/openerp_....dump target=openerp_restore_20260813
```

`prod-restore` rechaza la base configurada, cualquier base ya existente,
symlinks, dumps sin metadata/checksum y checksums incorrectos. Crea una base
nueva, restaura sin `--clean`, y valida conexión, revisión Alembic, tablas
críticas y conteos de usuarios/productos/ventas. No termina conexiones ni
modifica la base original.

Si `OPENERP_DATABASE_URL_FILE` sólo existe dentro del contenedor, proporciona
al proceso del host `OPENERP_RESTORE_SERVER_URL_FILE` (o
`OPENERP_RESTORE_SERVER_URL`) apuntando al mismo servidor. No pases una URL con
contraseña como argumento del comando.

Después del mensaje `verified restore`:

1. Ajusta sólo el nombre de base en `OPENERP_DATABASE_URL` o su fichero secreto.
2. Selecciona la imagen compatible mediante `export OPENERP_VERSION=<commit>`.
3. Ejecuta `make prod-start-api-web`, `make prod-wait-api` y
   `make prod-smoke`.
4. Ejecuta `make prod-start-worker` y `make prod-worker-check`.
5. Sólo entonces ejecuta `rm deploy/maintenance/enabled`.

### 4.3. Rollback de un upgrade fallido

No arranques código antiguo sobre el esquema nuevo y no uses un downgrade
genérico. Mantén mantenimiento y escritores parados; conserva la base fallida
para diagnóstico y restaura el backup pre-upgrade en otra base:

```bash
PREVIOUS="$(cat deploy/state/previous-version)"
make prod-restore f="$(cat deploy/state/last-backup)" \
  target=openerp_rollback_$(date -u +%Y%m%dT%H%M%SZ)
export OPENERP_VERSION="$PREVIOUS"
# cambia OPENERP_DATABASE_URL[_FILE] para apuntar a la base restaurada
make prod-start-api-web
make prod-wait-api
make prod-smoke
make prod-start-worker
make prod-worker-check
rm deploy/maintenance/enabled
```

Si el backup falla, no comienza Alembic. Si Alembic falla, no arranca la API.
Si health/smoke falla, API/worker vuelven a quedar parados. En los tres casos el
503 de mantenimiento permanece hasta una decisión del operador.

### 4.4. Copia externa

La retención anterior es local. Automatizar `make prod-backup` puede ser útil,
pero además hay que copiar dumps, checksums y metadata a otra máquina o medio
cifrado: el mismo disco no protege contra incendio, ransomware, robo o pérdida
del host. OpenERP no implementa todavía copia offsite ni recuperación punto en
el tiempo.

```cron
# ejemplo: backup diario a las 3:00
0 3 * * * cd /ruta/a/openerp && make prod-backup >> /var/log/openerp-backup.log 2>&1
```

---

## 5. Gestión de usuarios y roles

Desde el propio panel, en `https://<host>/admin`: **Usuarios y roles** en
el menú lateral, con una pestaña **Usuarios** y otra **Roles** dentro
(cada pestaña visible según tus permisos — ver §5.1). Esta es la vía normal y
soportada de administración; Swagger no existe en producción y no se requieren
llamadas HTTP manuales.

### 5.1. Roles de partida

| Rol | Permisos por defecto | Pensado para |
| --- | --- | --- |
| `ADMIN` | todos | Dueño/gerencia con acceso total. |
| `MANAGER` | `admin.access`, `users.manage` y gestión ordinaria de catálogo, precios, proveedores, compras/recepciones, inventario/lotes, ventas, devoluciones, tickets, dashboards, avisos, outbox e informes | Encargado de tienda. Por defecto no gestiona roles, auditoría ni configuración funcional global. |
| `CASHIER` | `pos.access`, lectura de producto/inventario/lotes y lectura/gestión de ventas | Cajero: opera el TPV y dispone de las lecturas que éste necesita, sin acceso al panel. |

No son una lista cerrada: en **Roles** (requiere `roles.manage`, concedido por
defecto a `ADMIN`) se pueden crear roles nuevos y marcar qué permisos tiene
cada uno. El catálogo completo de claves disponibles (a fecha
de esta guía incluye, entre otras:
`admin.access`, `pos.access`, `users.manage`, `roles.manage`, `audit.read`,
`product.read`/`product.manage`, `pricing.manage`, `supplier.read`/`.manage`,
`purchase.read`/`.manage`, `receiving.read`/`.manage`, `inventory.read`/`.manage`,
`lot.read`/`.manage`, `sale.read`/`.manage`, `return.read`/`.manage`,
`ticket.manage`, `pos_category.manage`, `dashboard.read`/`.manage`,
`notification.read`/`.manage`, `job.read`/`.manage`) también se ve en la
propia pantalla **Roles** al crear/editar uno.

La autoridad depende de permisos, no del nombre del rol. Un usuario no puede
crear o asignar un rol que contenga permisos que él mismo no posee. Tampoco se
puede desactivar o degradar al último usuario activo capaz de gestionar tanto
usuarios como roles; esa protección evita dejar la instalación sin una vía de
recuperación administrativa.

### 5.2. Dar de alta un usuario

En **Usuarios** → **Nuevo usuario**: email, nombre, contraseña provisional
y rol (desplegable con los roles existentes). La persona debería cambiar
esa contraseña provisional desde **Mi cuenta**. Comunícala por un canal seguro:
la creación inicial no fuerza automáticamente el cambio en la versión actual.

**Restablecer contraseña** es distinto: establece una clave temporal de al
menos 12 caracteres, revoca todas las sesiones de esa cuenta y activa
`must_change_password`. En el siguiente login el usuario sólo puede elegir una
contraseña nueva; no puede entrar al TPV o al panel hasta hacerlo. No existe un
flujo autónomo «olvidé mi contraseña» por email.

### 5.3. Desactivar un usuario

Los usuarios nunca se borran (conservan su histórico) — se desactivan, y
desde ese momento no pueden iniciar sesión. Botón **Desactivar** en la fila
del usuario en **Usuarios** (no aparece en tu propia fila — no puedes
desactivarte a ti mismo desde el panel). **Activar** permite recuperarlo sin
perder su historial.

### 5.4. Cerrar otra sesión propia

En **Mi cuenta → Sesiones activas**, cada usuario puede revisar dispositivo,
IP y última actividad y cerrar sus otras sesiones. La sesión actual se cierra
con **Salir**. `users.manage` no concede una pantalla para revocar sesiones de
otra persona; un restablecimiento de contraseña o la desactivación sí revoca
todas las sesiones de esa cuenta.

---

## 6. Configuración funcional de la tienda

La pantalla **Configuración** requiere `settings.read` para consultar y
`settings.manage` para guardar. Los valores residen en PostgreSQL y afectan a
la operación de la tienda: nombre visible, `business.timezone`, TPV, reglas de
venta y catálogo, avisos y apariencia.

`business.timezone` debe ser un nombre IANA, por ejemplo `Europe/Madrid`.
Ventas, tickets, dashboards, informes, recepciones, devoluciones y auditoría la
usan para mostrar o agrupar fechas. Cambiarla no modifica timestamps
históricos, aunque puede cambiar el día comercial en el que se presenta un
instante cercano a medianoche.

No añadas al registro funcional secretos ni parámetros de proceso. Base de
datos, pool, CORS, cookies, rate limit, bootstrap, proxy y credenciales SMTP se
configuran exclusivamente mediante entorno o `*_FILE` (§2.3).

---

## 7. Correo de producción

Mailpit sólo forma parte de `docker/compose.yml` de desarrollo y nunca publica
una interfaz en el stack de producción. Si producción debe enviar avisos,
configura un relay corporativo antes de activar destinatarios.

SMTP es infraestructura y sus credenciales no se almacenan ni se editan en
PostgreSQL. El panel **Configuración** contiene sólo opciones funcionales de
la tienda. Para cambiar el relay:

1. En `.env.production`, cambia:
   ```
   OPENERP_SMTP_HOST=<host del SMTP corporativo>
   OPENERP_SMTP_PORT=<puerto, típicamente 587>
   OPENERP_SMTP_USE_TLS=true
   OPENERP_SMTP_USERNAME=<usuario>
   OPENERP_SMTP_PASSWORD=<contraseña>
   OPENERP_SMTP_FROM_EMAIL=<remitente autorizado por ese SMTP>
   ```
   También puedes usar `OPENERP_SMTP_PASSWORD_FILE=/run/secrets/...`.
2. `make prod-restart` para que API y, especialmente, el worker lean la
   configuración nueva.

Si el SMTP corporativo está caído,
las ventas y el resto de la aplicación no se ven afectadas — los mensajes
sólo se acumulan `PENDING` en la cola hasta que el worker pueda entregarlos.

---

## 8. Monitorización y solución de problemas

| Síntoma | Dónde mirar | Causa típica |
| --- | --- | --- |
| El login redirige a `/login` en bucle | `make prod-logs` (servicio `web`) | Se accede por `http://` en vez de `https://`, o el certificado no coincide con el hostname usado — la cookie `Secure` no se envía. |
| El navegador dice que el certificado no es válido | — | Certificado autofirmado sin importar en ese equipo (§2.2) — no es un fallo del servidor. |
| `make prod-smoke` falla en readiness | `make prod-logs` (servicio `api`) | PostgreSQL no arrancó o `OPENERP_DATABASE_URL` no coincide con `POSTGRES_*`. |
| Un correo de incidencia no llega | Logs del servicio `worker` | El worker no está corriendo, o el SMTP configurado rechaza la conexión — la venta/incidencia en sí no se ve afectada (regla 10). |
| Hay una versión nueva pendiente | — | Las actualizaciones se hacen con `make prod-deploy`; no combines `git pull`, `prod-build` y `prod-up` manualmente. |

`make prod-logs` sigue los logs de los servicios a la vez; para uno
solo: `docker compose -f docker/compose.prod.yml --env-file .env.production
logs -f <servicio>`.

---

## 9. Seguridad — qué revisar antes de anunciar el despliegue

- `.env.production` con contraseñas propias, no las de `.env.production.example`.
- HTTPS con un certificado importado en los equipos que van a usarlo (§2.2).
- Firewall/LAN: sólo Nginx 80/443; API sin puerto host y PostgreSQL sólo en
  `127.0.0.1` (§3.2).
- El primer administrador (§2.5) con una contraseña que no sea la de
  ejemplo de esta guía.
- `OPENERP_LOGIN_RATE_LIMIT_*` (valores por defecto ya razonables: 5
  intentos por email, 20 por IP, cada 5 minutos) — sólo tocar si la tienda
  tiene un patrón de uso atípico.
- Backups (§4) probados al menos una vez con `make prod-restore` hacia una base
  nueva y descartable — un backup que nunca se ha restaurado no demuestra que
  el procedimiento de recuperación funciona.
