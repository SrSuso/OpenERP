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
make prod-build     # refresca las bases fijadas y construye backend/frontend
make prod-up        # con escritores aún offline: levanta, migra y arranca el stack
```

Las imágenes de runtime se fijan por versión de parche (`Python 3.13.15`,
`Node 22.22.0`, `Nginx 1.27.5` y `PostgreSQL 17.10`). `make prod-build` usa
`docker compose build --pull`: conserva la caché de capas de aplicación, pero
comprueba deliberadamente la base correspondiente al tag fijado. Actualiza esos
tags mediante un commit revisado; no se usan `latest` ni tags de major para el
runtime de producción. Para diagnosticar una caché o preparar una release existe
`make prod-build-clean`, que añade `--no-cache`; no es el camino habitual.

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
make prod-deploy branch=v2 # cambia a la rama remota v2 y despliega su último commit
```

`branch=<nombre>` es una selección explícita de rama remota: el script valida
el nombre, obtiene `origin/<nombre>`, cambia el checkout a esa rama y hace un
`pull --ff-only` de ella antes de construir. Sin `branch=`, conserva el
comportamiento habitual: actualiza la rama ya seleccionada. El checkout queda
en la rama desplegada para que el siguiente despliegue sea coherente y el
script sigue rechazando cambios locales.

OpenERP **0.8** es el cierre de la primera versión. Para desarrollar y probar
v2, crea y publica una rama de v2 y usa este parámetro únicamente desde un
checkout y un entorno de prueba separados. El parámetro no crea una base de
datos, volúmenes ni red independientes: usarlo contra la instalación que
atiende la tienda aplicaría el código y las migraciones de v2 sobre sus datos.
Nunca se debe usar como una vista previa de v2 sobre la base de producción de
0.8.

Antes de activar mantenimiento, el despliegue comprueba que la rama elegida
conoce la revisión Alembic que ya tiene la base. Si no la contiene, se detiene
con la tienda todavía online. Esto evita arrancar código antiguo sobre un
esquema de una rama posterior, pero no convierte ni revierte bases entre
ramas: para volver a una versión anterior hay que restaurar su backup en una
base aislada y hacer el corte controlado descrito en §4.

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

Los `up` del procedimiento oficial incluyen `--remove-orphans`. El nombre de
proyecto estable `openerp-prod` acota esa limpieza a contenedores que pertenezcan
a este Compose; no ejecuta `docker system prune`, ni borra imágenes, volúmenes o
contenedores de otros proyectos. Durante un deploy se aplica al recrear Nginx,
cuando mantenimiento ya está activo.

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
| `Content-Security-Policy` | Recursos del propio servidor; además, `connect-src` permite WSS sólo en los cuatro puertos reservados de QZ Tray: 8181/8282/8383/8484. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=(), payment=(), usb=()` |
| `Strict-Transport-Security` | `max-age=31536000` |

La CSP no permite scripts inline ni `unsafe-eval`. Las conexiones WSS sólo
pueden salir hacia los puertos seguros 8181/8282/8383/8484 de QZ; el destino
concreto se valida y guarda en **Terminales POS**, y QZ valida además la
autorización o firma de cada cliente. No abras esos puertos fuera de la LAN. `style-src
'unsafe-inline'` es la única excepción: React usa estilos calculados para
colores/alturas y ECharts CanvasRenderer posiciona su canvas mediante atributos
`style`. Scripts, API, imágenes y fuentes permanecen same-origin; `data:` sólo
se abre para imágenes. HSTS se emite únicamente en el servidor HTTPS, sin
`includeSubDomains` ni `preload`. El despliegue soportado termina TLS en este
Nginx. Si TLS termina en otro proxy, configura explícitamente esa topología
antes de exponerla; no confíes en un `X-Forwarded-Proto` enviado por el cliente.

Producción exige la lista CORS vacía y falla antes del downtime si una
configuración antigua todavía contiene orígenes. Desarrollo conserva el origen
explícito `http://localhost:5173`. La sesión mantiene cookie
`Secure`, `HttpOnly`, `SameSite=Lax`; el POST cross-site normal no recibe esa
cookie y no se añadió una capa CSRF innecesaria para esta topología same-origin.

## 3.3. Registrar terminales y configurar el TPV

Antes de abrir el TPV por primera vez, entra en **Configuración de la tienda →
Terminales POS** y crea cada puesto físico (Caja 1, Caja 2…) asignándolo a su
almacén.
El almacén no se puede cambiar después: las ventas conservan el ID del
terminal como histórico. Se puede renombrar o desactivar, pero no borrar.

En esa misma pantalla se concentra lo propio de la caja: fondo, tamaño de
letra, color de los botones de cobro, método de pago inicial, actualización del
catálogo e impresión automática. El interruptor **Buscar productos** es por
terminal: al activarlo, tocar el recuadro superior de búsqueda del TPV abre el
catálogo con teclado táctil; al desactivarlo queda disponible el lector de
códigos y la rejilla de productos.

El navegador pide uno de los terminales activos y guarda la elección
localmente. Cambiar de usuario no cambia de caja. Para elegir otra, pulsa el
nombre del terminal en la cabecera del TPV.

El acceso al TPV es independiente del de administración. En
**Administración → Usuarios y roles → Usuarios**, asigna al cajero un rol con
`pos.access`, configura su **Usuario TPV** y PIN de 4 a 12 dígitos y pulsa
**Dar acceso TPV**. Sólo los usuarios habilitados aparecen en `/pos/login`;
allí se elige el usuario y se escribe el PIN en la pantalla. Deshabilitar el
acceso lo retira inmediatamente sin borrar ventas, cierres ni auditoría.

Si se rompe una caja con un borrador pendiente, **no la borres ni esperes que
el borrador se mueva solo**. Desactiva el terminal para impedir más operación
y localiza la venta «Sin cobrar» en **Ventas**: allí permanece visible con el
terminal que la originó. La versión actual no transfiere borradores entre
terminales.

## 3.4. La caja: impresión térmica con QZ Tray

El procedimiento completo de instalación del PC de caja, impresión remota,
certificados WSS, firewall y firma silenciosa está en
[`QZ_TRAY_POS_SETUP.md`](QZ_TRAY_POS_SETUP.md). Esta sección conserva el resumen
operativo de la integración.

La impresión habitual no usa el diálogo de Chrome. El servidor Ubuntu entrega
el ticket a la web y QZ Tray, instalado en el ordenador Windows de la caja,
envía una imagen ESC/POS directamente a la impresora USB local.

### QZ en el mismo ordenador que abre el TPV

Configuración mínima del ordenador de la caja:

1. Instala el controlador de la POSPrinter y comprueba en Windows que su nombre
   es exactamente **`POSPrinter POS-80`**.
2. Instala QZ Tray, ábrelo y activa su inicio automático con Windows.
3. En **Configuración de la tienda → Terminales POS → Impresión mediante QZ
   Tray**, guarda `localhost`, puerto `8181` y el nombre exacto de la impresora.
4. Pulsa **Probar conexión e impresora guardadas**. En el primer uso, acepta la
   autorización que muestre QZ Tray.
5. Cobra una venta de prueba. OpenERP debe mostrar el destino configurado y la
   impresora debe cortar un único ticket.

### Imprimir desde otro ordenador de administración

El navegador siempre habla directamente con QZ. Para reimprimir desde un PC de
administración, éste se conecta por WSS al PC Windows que tiene la impresora; el
servidor Ubuntu no actúa como puente de impresión. Reserva una IP fija para el
PC de caja (en estos ejemplos, `192.168.1.50`) y haz lo siguiente en ese PC:

1. Abre **Símbolo del sistema como administrador** y genera el certificado WSS
   de QZ incluyendo la IP fija:

   ```bat
   cd "%PROGRAMFILES%\QZ Tray"
   qz-tray-console.exe certgen --host "192.168.1.50"
   ```

   Si se usa un nombre DNS estable, genera el certificado para ese nombre y
   guarda exactamente el mismo nombre en OpenERP. Reinicia QZ después.
2. Cierra y vuelve a abrir QZ. Es obligatorio reiniciarlo cada vez que se
   regenera el certificado.
3. En Firewall de Windows permite entrada TCP al puerto 8181 sólo desde los PCs
   que deban imprimir. Por ejemplo, desde PowerShell como administrador, si el
   PC de administración es `192.168.1.20`:

   ```powershell
   New-NetFirewallRule -DisplayName "QZ Tray WSS 8181 desde OpenERP" `
     -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8181 `
     -RemoteAddress 192.168.1.20 -Profile Private
   ```

   Añade la IP del propio TPV si ese navegador también se conectará mediante la
   IP remota. No publiques este puerto en el router ni en Internet.
4. Copia `root-ca.crt` del directorio compartido de QZ a cada PC que vaya a
   abrir OpenERP e instálalo en **Equipo local → Entidades de certificación raíz
   de confianza**. Permite al navegador confiar en el WSS privado; no contiene
   la clave privada de firma descrita más abajo.
5. En **Terminales POS → Impresión mediante QZ Tray**, guarda:
   - servidor QZ: `192.168.1.50`;
   - puerto seguro: `8181`;
   - impresora: `POSPrinter POS-80` (o su nombre exacto en Windows).
6. Guarda primero y pulsa **Probar conexión e impresora guardadas**. El botón
   confirma por separado la conexión WSS, la cola de Windows y si la firma
   silenciosa está activa.

La configuración es común para TPV, Ventas, Devoluciones y Cierres Z. Si sólo
hay una impresora de caja es el comportamiento deseado. No se introducen claves
privadas ni certificados en ese panel.

OpenERP genera una imagen de **576 puntos**: el ancho real del cabezal de esta
impresora (72 mm a 203 dpi). La misma imagen se muestra en la vista previa y se
envía a QZ, así que Chrome y el controlador no pueden volver a escalar el texto
ni ignorar los márgenes. El rollo sigue midiendo 80 mm; los 4 mm laterales
restantes son el margen físico entre papel y cabezal.

Si aparece un error:

- comprueba que el icono de QZ Tray está activo junto al reloj de Windows;
- comprueba que Windows muestra exactamente `POSPrinter POS-80` y que la
  impresora no está pausada ni sin conexión;
- acepta la solicitud de autorización de QZ Tray;
- pulsa **Reintentar con QZ Tray**.

No existe impresión térmica mediante el diálogo del navegador. Tickets nuevos,
reimpresiones desde Ventas o Devoluciones, cierres Z y reimpresiones de cierres
usan el mismo envío ESC/POS mediante QZ. Si QZ falla, se muestra el error y debe
corregirse o reintentarse; no se cambia silenciosamente a un documento A4.

QZ Tray puede advertir sobre trabajos sin firma. La firma con certificado es el
paso operativo necesario para eliminar sus mensajes **Allow** en un puesto
definitivo. Es distinta del certificado WSS `root-ca.crt`: usa el certificado
de firma y `private-key.pem` obtenidos mediante QZ Site Manager o un certificado
oficial de QZ. La clave privada queda exclusivamente en Ubuntu:

```bash
cd /home/su_admin/OpenERP
install -d -m 750 deploy/qz-signing
install -m 640 /ruta/segura/digital-certificate.txt deploy/qz-signing/
install -m 640 /ruta/segura/private-key.pem deploy/qz-signing/
id -g
```

Pon el número mostrado por `id -g` en `OPENERP_HOST_SECRET_GID` y activa en
`.env.production`:

```dotenv
OPENERP_HOST_SECRET_GID=1000
OPENERP_QZ_SIGNING_CERTIFICATE_FILE=/run/secrets/qz-signing/digital-certificate.txt
OPENERP_QZ_SIGNING_PRIVATE_KEY_FILE=/run/secrets/qz-signing/private-key.pem
```

Los ficheros de `deploy/qz-signing/` están ignorados por Git. Reinicia API y
worker mediante el despliegue soportado; el API entrega sólo el certificado
público al navegador y firma cada digest en el servidor. Nunca copies
`private-key.pem` al frontend, al panel ni al repositorio. En QZ debe confiarse
una vez en ese certificado; después el botón de prueba muestra **Firma
silenciosa: activa** y las llamadas protegidas ya no provocan avisos repetidos.
El permiso de acceso a la red local que pueda pedir Chrome/Edge es independiente
de QZ: se concede una vez al sitio o mediante la política corporativa del
navegador, no se puede ocultar desde JavaScript.

Las claves de demostración creadas en **QZ → Advanced → Site Manager** sólo son
válidas para la instalación de QZ que las generó: sirven para esta única caja y
para comprobar el circuito. Un despliegue que deba confiar en varios servidores
QZ utiliza un certificado de firma oficial. Consulta las guías oficiales de
[QZ Print Server](https://qz.io/docs/print-server) y
[firma de mensajes](https://qz.io/docs/signing).

La explicación del modelo físico, los márgenes y el editor está en
[`TICKET_TEMPLATE_EDITOR.md`](TICKET_TEMPLATE_EDITOR.md).

### 3.5. Mantener las plantillas de ticket

En **Configuración de la tienda → Plantillas de ticket**, crea o revisa la
plantilla que imprime la caja. La vista previa permite ajustar los márgenes
laterales y verticales; el ancho útil se calcula restando los laterales de los
80 mm del papel, igual que en LibreOffice. También permite ajustar fuente,
tamaño, grosor, interlineado, cabecera,
pie, datos fiscales, fecha, textos y líneas que se muestran. Se puede elegir el
editor estándar o el editor seguro con variables documentado en
[`TICKET_TEMPLATE_EDITOR.md`](TICKET_TEMPLATE_EDITOR.md). Sólo una plantilla
está activa; usa **Usar esta** para cambiarla sin editar otra por error.

Los cambios no alteran tickets ya emitidos. También se pueden eliminar plantillas
equivocadas, incluso usadas: el ticket ya generado conserva el texto y perfil
que se imprimieron. Si se elimina la activa, crea o activa otra antes de volver
a cobrar para que la caja tenga plantilla disponible.

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

Los procedimientos de interfaz están separados por perfil en los
[manuales por rol](roles/README.md):
[cajero](roles/CASHIER.md), [encargado](roles/MANAGER.md) y
[administrador](roles/ADMIN.md). Úsalos para asignar una cuenta a cada puesto;
este capítulo explica cómo se conceden esas capacidades.

### 5.1. Roles de partida

| Rol | Permisos por defecto | Pensado para |
| --- | --- | --- |
| `ADMIN` | todos | Dueño/gerencia con acceso total. |
| `MANAGER` | `admin.access`, `users.manage` y gestión ordinaria de catálogo, precios, proveedores, compras/recepciones, inventario/lotes, ventas, devoluciones, dashboards, avisos, outbox e informes | Encargado de tienda. Por defecto no gestiona roles, auditoría, configuración funcional, terminales POS ni plantillas de ticket. |
| `CASHIER` | `pos.access`, lectura de producto/inventario/lotes y lectura/gestión de ventas | Cajero: opera el TPV y dispone de las lecturas que éste necesita, sin acceso al panel. |

No son una lista cerrada: en **Roles** (requiere `roles.manage`, concedido por
defecto a `ADMIN`) se pueden crear roles nuevos y marcar qué permisos tiene
cada uno. El catálogo completo de claves disponibles (a fecha
de esta guía incluye, entre otras:
`admin.access`, `pos.access`, `users.manage`, `roles.manage`, `audit.read`,
`product.read`/`product.manage`, `pricing.manage`, `supplier.read`/`.manage`,
`purchase.read`/`.manage`, `receiving.read`/`.manage`, `inventory.read`/`.manage`,
`lot.read`/`.manage`, `sale.read`/`.manage`, `return.read`/`.manage`,
`ticket.manage`, `pos_terminal.manage`, `pos_category.manage`, `dashboard.read`/`.manage`,
`notification.read`/`.manage`, `job.read`/`.manage`) también se ve en la
propia pantalla **Roles** al crear/editar uno.

La autoridad depende de permisos, no del nombre del rol. Un usuario no puede
crear o asignar un rol que contenga permisos que él mismo no posee. Tampoco se
puede desactivar o degradar al último usuario activo capaz de gestionar tanto
usuarios como roles; esa protección evita dejar la instalación sin una vía de
recuperación administrativa.

### 5.2. Dar de alta un usuario y habilitarlo para TPV

En **Usuarios** → **Nuevo usuario**: email, nombre, contraseña provisional
y rol (desplegable con los roles existentes). Si la persona va a cobrar,
rellena también **Usuario TPV** y **PIN TPV** (4–12 dígitos): al crearla queda
habilitada para TPV. Para una cuenta ya existente, usa **Configurar TPV** y
después **Dar acceso TPV** en su fila. El usuario TPV no lo determina React ni
el terminal: el backend lo obtiene de esa cuenta habilitada y exige además que
su rol tenga `pos.access`.

La persona debería cambiar esa contraseña provisional desde **Mi cuenta**.
Comunícala por un canal seguro:
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

Los cinco servicios de producción usan el driver Docker `json-file` con cinco
ficheros de hasta 10 MiB cada uno. Esta rotación limita stdout/stderr del stack
a unos 250 MiB; no limita el volumen de PostgreSQL, su WAL ni los backups. API y
worker respetan `OPENERP_LOG_FORMAT`: `json` produce una línea JSON por evento y
`console` conserva el formato legible para desarrollo.

Antes de un deploy, `make prod-preflight` exige al menos 1 GiB libre (ajustable
con `OPENERP_DEPLOY_MIN_FREE_KB`) en el checkout/backups y en el directorio de
datos de Docker si existe. Vigila además el volumen `postgres-data`, `backups/`
según la retención de A18 y la caché/imágenes Docker. PostgreSQL no tiene un
límite Compose arbitrario: el operador debe reservar memoria y CPU suficientes
para el tamaño de la base y los informes; API (512 MiB/1 CPU), worker (256
MiB/0,5 CPU) y web (128 MiB/0,5 CPU) sí tienen límites de contención.

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
