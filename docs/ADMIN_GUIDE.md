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

Seis piezas, cada una su propio contenedor, definidas en
[`docker/compose.prod.yml`](../docker/compose.prod.yml):

| Servicio | Qué es | Accesible desde la LAN |
| --- | --- | --- |
| `web` | nginx: sirve el frontend compilado y hace de proxy HTTPS hacia `api` | Sí — puertos 80/443 |
| `api` | El backend (FastAPI/uvicorn) | No directamente — sólo a través de `web` |
| `worker` | Envía los correos encolados (incidencias, etc.) | No — no expone ningún puerto |
| `migrate` | Aplica las migraciones y termina; no es un servicio permanente | No |
| `postgres` | La base de datos | No — sólo `127.0.0.1` del propio servidor (backups) |
| `mailpit` | Bandeja de correo interna para pruebas, sustituible por un SMTP real (§6) | No — sólo `127.0.0.1` del propio servidor |

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

Si esto es para probar rápido y prefieres no distribuir el certificado a
cada equipo todavía, cada usuario puede aceptar la advertencia del
navegador manualmente ("Avanzado → continuar de todos modos") — funciona,
pero cada uno la vuelve a ver hasta que se importe el certificado.

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
- `OPENERP_CORS_ORIGINS` — el `https://` + hostname/IP que elegiste en 2.2.
- El resto de valores por defecto sirven para arrancar; el fichero
  documenta cada uno inline. Detalle de qué es cada variable en
  [`ARCHITECTURE.md`](ARCHITECTURE.md#22-configuración-appcoreconfigpy).

### 2.4. Construir y arrancar

```bash
make prod-build     # construye las imágenes propias de backend y frontend
make prod-up        # levanta postgres, mailpit, aplica el compose completo
make prod-migrate   # aplica las migraciones (también se puede repetir sin riesgo)
```

`make prod-up` espera a que los healthchecks pasen antes de devolver el
control (`--wait`). Compruébalo en cualquier momento con:

```bash
make prod-ps
make prod-logs      # Ctrl-C para dejar de seguir
```

### 2.5. Crear el primer administrador

No hay registro público — se crea una vez por instalación. Con
`OPENERP_BOOTSTRAP_ADMIN_EMAIL`/`OPENERP_BOOTSTRAP_ADMIN_PASSWORD` ya puestos
en `.env.production` (la plantilla trae un valor por defecto, §2.3), no
hace falta contestar nada:

```bash
make prod-bootstrap-admin
```

Es idempotente: si ya existe un admin con ese email, no hace nada y termina
bien — seguro de dejar en un procedimiento de despliegue repetible. Si
prefieres no dejar la contraseña por defecto en el `.env.production`
(queda en texto plano en el servidor), borra esas dos líneas del fichero
antes de este paso y el comando te la pedirá de forma interactiva en su
lugar.

**Entra y cámbiala de inmediato**: `https://<host>/admin` con el email y la
contraseña de `.env.production` → **Mi cuenta** en el menú lateral →
cambia la contraseña ahí. Mientras no lo hagas, cualquiera con el
`.env.production` (o con el valor por defecto de este documento) tiene
acceso de administrador total.

### 2.6. Verificar

Desde un equipo de la red interna, con el certificado ya importado (§2.2):

- Panel: `https://<host>/admin`
- TPV: `https://<host>/pos`
- Estado de la API: `https://<host>/api/v1/health/ready` → `{"status":"ok","database":"ok"}`

---

## 3. Operación del día a día

| Tarea | Comando |
| --- | --- |
| Ver estado de los servicios | `make prod-ps` |
| Ver logs en vivo | `make prod-logs` |
| Parar el stack (conserva los datos) | `make prod-down` |
| Reiniciar API y worker (tras editar `.env.production`) | `make prod-restart` |
| Aplicar migraciones pendientes | `make prod-migrate` |

### 3.1. Desplegar una actualización de código

```bash
make prod-deploy               # git pull + build + migrate + up, en ese orden
make prod-deploy backup=1      # además, hace un prod-backup antes de tocar nada
make prod-deploy force=1       # redespliega aunque git pull no traiga commits nuevos
```

Equivale a `scripts/deploy-update.sh`, que hace exactamente estos cuatro
pasos y para en seco si alguno falla:

```bash
git pull --ff-only
make prod-build
make prod-migrate
make prod-up          # recrea los contenedores con las imágenes nuevas
```

El orden importa: `migrate` corre y debe terminar con éxito antes de que
`api`/`worker` arranquen (lo hace `docker compose` solo, vía
`depends_on: condition: service_completed_successfully`) — un despliegue
nunca deja la aplicación corriendo contra un esquema a medio migrar. El
script también se niega a arrancar si el checkout tiene cambios locales sin
commitear (`git status`), para no pisarlos con el `pull`.

---

## 4. Copias de seguridad

Los mismos scripts que en desarrollo (`scripts/backup-postgres.sh`,
`scripts/restore-postgres.sh`), ya que `postgres` publica su puerto sólo en
`127.0.0.1` del propio servidor:

```bash
make prod-backup   # vuelca a backups/openerp_<timestamp>.dump
```

Para restaurar (¡destructivo, pide confirmación explícita!) hace falta
apuntar explícitamente al `127.0.0.1:5432` publicado por `postgres` — a
diferencia del backup, `make db-restore` no hace esa sustitución por ti:

```bash
./scripts/restore-postgres.sh backups/openerp_....dump \
  "postgresql://openerp:<la contraseña de POSTGRES_PASSWORD>@127.0.0.1:5432/openerp"
```

Recomendado: automatizar `make prod-backup` con un cron del sistema y copiar
`backups/` fuera del servidor (a otra máquina o almacenamiento de red) — un
`pg_dump` en el mismo disco que la base de datos no protege de un fallo de
disco.

```cron
# ejemplo: backup diario a las 3:00
0 3 * * * cd /ruta/a/openerp && make prod-backup >> /var/log/openerp-backup.log 2>&1
```

---

## 5. Gestión de usuarios y roles

Desde el propio panel, en `https://<host>/admin`: **Usuarios y roles** en
el menú lateral, con una pestaña **Usuarios** y otra **Roles** dentro
(cada pestaña visible según tus permisos — ver §5.1). Ya no hace
falta `curl` ni Swagger UI para esto; se dejan documentados al final de
cada apartado sólo como referencia/alternativa si alguna vez la necesitas
(automatizar un alta en un script, por ejemplo).

### 5.1. Roles de partida

| Rol | Permisos por defecto | Pensado para |
| --- | --- | --- |
| `ADMIN` | todos | Dueño/gerencia con acceso total. |
| `MANAGER` | `admin.access`, `users.manage` | Encargado de tienda: entra al panel, da de alta/desactiva personal y les asigna un rol existente — no puede crear roles nuevos ni tocar qué permisos tiene cada uno. |
| `CASHIER` | `pos.access` | Cajero: sólo el TPV. |

No son una lista cerrada: en **Roles** (sólo visible para `ADMIN` —
necesita `roles.manage`) se pueden crear roles nuevos y marcar qué
permisos tiene cada uno. Referencia por `curl`:
`GET /api/v1/permissions`/`PATCH /roles/{id}/permissions` — el catálogo
completo de claves disponibles (a fecha de esta guía incluye, entre otras:
`admin.access`, `pos.access`, `users.manage`, `roles.manage`, `audit.read`,
`product.read`/`product.manage`, `pricing.manage`, `supplier.read`/`.manage`,
`purchase.read`/`.manage`, `receiving.read`/`.manage`, `inventory.read`/`.manage`,
`lot.read`/`.manage`, `sale.read`/`.manage`, `return.read`/`.manage`,
`ticket.manage`, `pos_category.manage`, `dashboard.read`/`.manage`,
`notification.read`/`.manage`, `job.read`/`.manage`) también se ve en la
propia pantalla **Roles** al crear/editar uno.

### 5.2. Dar de alta un usuario

En **Usuarios** → **Nuevo usuario**: email, nombre, contraseña provisional
y rol (desplegable con los roles existentes). La persona debería cambiar
esa contraseña provisional desde **Mi cuenta** en su primer inicio de
sesión — el panel no fuerza el cambio todavía, es cosa de decírselo.

Por `curl`, si hiciera falta automatizarlo:

```bash
curl -b cookies.txt https://<host>/api/v1/roles          # averigua el id del rol
curl -b cookies.txt -X POST https://<host>/api/v1/users \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "cajero1@tuempresa.example",
    "full_name": "Nombre Apellido",
    "password": "una contraseña de al menos 8 caracteres",
    "role_id": 3
  }'
```

### 5.3. Desactivar un usuario

Los usuarios nunca se borran (conservan su histórico) — se desactivan, y
desde ese momento no pueden iniciar sesión. Botón **Desactivar** en la fila
del usuario en **Usuarios** (no aparece en tu propia fila — no puedes
desactivarte a ti mismo desde el panel). Por `curl`:

```bash
curl -b cookies.txt -X POST https://<host>/api/v1/users/<id>/deactivate
```

### 5.4. Cerrar la sesión de otro terminal

Útil cuando alguien se dejó una sesión abierta en un TPV:

```bash
curl -b cookies.txt https://<host>/api/v1/auth/sessions
curl -b cookies.txt -X DELETE https://<host>/api/v1/auth/sessions/<id>
```

---

## 6. Correo: pasar de Mailpit a un SMTP real

Por defecto el despliegue usa Mailpit (bandeja de pruebas interna, UI en
`ssh -L 8025:127.0.0.1:8025 <servidor>` → `http://127.0.0.1:8025` en tu
propio equipo) — suficiente para verificar que las notificaciones se
generan sin depender del servidor de correo de la empresa desde el primer
día. Cuando quieras enviar correo de verdad:

### 6.1. Desde el panel de administración (recomendado)

Con un usuario `ADMIN`, entra en **Configuración** (`/admin/settings`,
permiso `settings.manage` — sólo `ADMIN` lo tiene por defecto) y rellena
host, puerto, usuario/contraseña, remitente y, si quieres, TLS. El botón
**"Enviar correo de prueba"** manda un correo real con lo que hay en el
formulario ahora mismo, sin necesidad de guardarlo antes ni de reiniciar
nada — así confirmas que las credenciales funcionan antes de darle a
Guardar. Al guardar, el cambio se aplica en el siguiente sondeo del
worker (`app/jobs/worker.py`, cada pocos segundos), sin `make
prod-restart` ni tocar `.env.production`. La contraseña nunca se vuelve
a mostrar una vez guardada (sólo indica si hay una guardada); dejar el
campo en blanco al editar el resto de campos la deja como estaba.

### 6.2. Por variables de entorno (arranque inicial / infra-as-code)

Sigue siendo la base que usa la app cuando no hay nada guardado desde el
panel (`app/settings/service.py` sólo sobreescribe lo que se ha
configurado ahí — un despliegue nuevo, sin nada guardado todavía, se
comporta exactamente igual que antes de la fase 21):

1. En `.env.production`, cambia:
   ```
   OPENERP_SMTP_HOST=<host del SMTP corporativo>
   OPENERP_SMTP_PORT=<puerto, típicamente 587>
   OPENERP_SMTP_USE_TLS=true
   OPENERP_SMTP_USERNAME=<usuario>
   OPENERP_SMTP_PASSWORD=<contraseña>
   OPENERP_SMTP_FROM_EMAIL=<remitente autorizado por ese SMTP>
   ```
2. `make prod-restart` (sólo recrea `api`/`worker`, que son los que leen
   estas variables).
3. Opcional: quita el servicio `mailpit` de `docker/compose.prod.yml` y su
   entrada en `.env.production` si ya no lo vas a usar ni para pruebas.

Regla 10 del proyecto sigue aplicando: si el SMTP corporativo está caído,
las ventas y el resto de la aplicación no se ven afectadas — los mensajes
sólo se acumulan `PENDING` en la cola hasta que el worker pueda entregarlos.

---

## 7. Monitorización y solución de problemas

| Síntoma | Dónde mirar | Causa típica |
| --- | --- | --- |
| El login redirige a `/login` en bucle | `make prod-logs` (servicio `web`) | Se accede por `http://` en vez de `https://`, o el certificado no coincide con el hostname usado — la cookie `Secure` no se envía. |
| El navegador dice que el certificado no es válido | — | Certificado autofirmado sin importar en ese equipo (§2.2) — no es un fallo del servidor. |
| `503` en `/api/v1/health/ready` | `make prod-logs` (servicio `api`) | PostgreSQL no arrancó o `OPENERP_DATABASE_URL` no coincide con `POSTGRES_*`. |
| Un correo de incidencia no llega | UI de Mailpit (§6) o logs del servicio `worker` | El worker no está corriendo, o el SMTP configurado rechaza la conexión — la venta/incidencia en sí no se ve afectada (regla 10). |
| Tras un `git pull` la app sigue con el código viejo | — | Falta `make prod-build` (reconstruir imágenes) antes de `make prod-up`. |

`make prod-logs` sigue los logs de los seis servicios a la vez; para uno
solo: `docker compose -f docker/compose.prod.yml --env-file .env.production
logs -f <servicio>`.

---

## 8. Seguridad — qué revisar antes de anunciar el despliegue

- `.env.production` con contraseñas propias, no las de `.env.production.example`.
- HTTPS con un certificado importado en los equipos que van a usarlo (§2.2).
- El primer administrador (§2.5) con una contraseña que no sea la de
  ejemplo de esta guía.
- `OPENERP_LOGIN_RATE_LIMIT_*` (valores por defecto ya razonables: 5
  intentos por email, 20 por IP, cada 5 minutos) — sólo tocar si la tienda
  tiene un patrón de uso atípico.
- Backups (§4) probados al menos una vez con `make db-restore` contra una
  base de datos de prueba — un backup que nunca se ha restaurado no está
  verificado.
