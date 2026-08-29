# Instalación de QZ Tray en el puesto POS

Esta guía deja operativa la impresora térmica del PC de caja para tickets,
reimpresiones de ventas y devoluciones, y cierres Z. OpenERP no usa el diálogo
de impresión del navegador ni documentos A4: envía el raster ESC/POS a QZ Tray.

## Arquitectura

```text
Navegador TPV o Administración
        │ WSS :8181
        ▼
PC Windows de caja con QZ Tray
        │ cola RAW de Windows
        ▼
Impresora térmica USB POSPrinter POS-80
```

El servidor Ubuntu aloja OpenERP y puede firmar los trabajos para evitar avisos
repetidos de QZ. No necesita estar conectado por USB a la impresora.

## Datos que debes anotar

| Dato                        | Ejemplo                | Uso                                         |
| --------------------------- | ---------------------- | ------------------------------------------- |
| IP fija del PC de caja      | `192.168.1.50`         | Servidor QZ guardado en OpenERP.            |
| IP del PC de administración | `192.168.1.20`         | PC autorizado por el firewall si reimprime. |
| URL de OpenERP              | `https://192.168.1.11` | Sitio que abren los navegadores.            |
| Cola Windows                | `POSPrinter POS-80`    | Nombre exacto requerido por QZ.             |

Reserva la IP del PC de caja en el router/DHCP o configúrala de forma estática.
Si cambia, hay que regenerar el certificado QZ y actualizar el panel.

## 1. Preparar Windows y la impresora

1. Conecta la impresora e instala su controlador Windows.
2. En **Configuración → Bluetooth y dispositivos → Impresoras y escáneres**,
   comprueba el nombre de la cola. Puede ser `POSPrinter POS-80` u otro; OpenERP
   debe recibir literalmente el nombre que Windows muestra.
3. Imprime una página de prueba desde Windows. Si esta prueba falla, primero
   corrige el controlador: QZ no sustituye al controlador.
4. Instala [QZ Tray](https://qz.io/download/), ábrelo y activa su inicio
   automático con Windows. El icono de QZ debe permanecer junto al reloj.

### 1.1. Conectar y probar el cajón de efectivo

El cajón no se conecta a Ubuntu ni directamente a QZ: conecta su cable RJ11/RJ12
al puerto **DK**, **Cash drawer** o similar de la parte trasera de la impresora
`POSPrinter POS-80`. No lo conectes a una toma telefónica o Ethernet.

Una vez guardado en OpenERP el mismo nombre de impresora que usa QZ, cada venta
cobrada total o parcialmente en **efectivo** envía una orden ESC/POS para abrir
el cajón. Las ventas exclusivamente con tarjeta no lo abren. Si la orden falla,
la venta ya queda cobrada y el TPV muestra **Reintentar abrir el cajón**: no se
debe repetir el cobro.

Si no abre, confirma primero que el cajón es compatible con el pulso de apertura
de la impresora y consulta el manual del fabricante de la impresora/cajón. QZ
envía el comando RAW estándar; no puede alimentar ni reparar un cableado o un
cajón incompatible.

## 2. Caso simple: el TPV está en el mismo PC que QZ

En **Configuración de la tienda → Terminales POS → Impresión mediante QZ Tray**
guarda:

- **Servidor QZ**: `localhost`.
- **Puerto seguro de QZ**: `8181`.
- **Nombre de la impresora en Windows**: `POSPrinter POS-80` o el nombre real.

Guarda y pulsa **Probar conexión e impresora guardadas**. Después cobra una
venta pequeña para confirmar que imprime y corta un único ticket.

## 3. Imprimir desde Administración u otro PC

Este caso permite reimprimir desde otro ordenador, mientras la impresora sigue
conectada al PC de caja. No guardes `localhost`: para el PC de administración,
`localhost` sería ese mismo PC y no el de caja.

### 3.1. Generar el certificado WSS en el PC de caja

1. Cierra QZ Tray desde su icono junto al reloj con **Exit**.
2. Abre **Símbolo del sistema como administrador**. El título debe empezar por
   `Administrador:`.
3. Ejecuta, cambiando la IP por la fija real del PC de caja:

   ```bat
   cd /d "C:\Program Files\QZ Tray"
   qz-tray-console.exe certgen --host "192.168.1.50"
   ```

4. El comando debe acabar sin `Installation step CERTGEN failed`. Abre QZ Tray
   de nuevo al terminar.

QZ crea o reemplaza estos ficheros:

```text
C:\ProgramData\qz\ssl\root-ca.crt
C:\ProgramData\qz\ssl\qz-tray.crt
```

Si aparece `qz-tray.properties (Acceso denegado)`, la consola no se ejecutó con
elevación real. Cierra QZ y repite desde CMD como administrador. No modifiques
los permisos de `Program Files`. No instales todavía `root-ca.crt` si `certgen`
ha fallado: al repetirlo correctamente se genera un conjunto coherente.

### 3.2. Arranque normal de QZ Tray en la caja

`qz-tray-console.exe` se usa únicamente para `certgen` y diagnóstico: mientras
esa ventana permanece abierta, mantiene QZ Tray ejecutándose; al cerrarla,
finaliza también el proceso. **No es el programa que debe quedar abierto en la
caja.**

Tras terminar `certgen`, inicia la aplicación normal, que deja el icono de QZ
en la bandeja de Windows:

```bat
start "" "%ProgramFiles%\QZ Tray\qz-tray.exe"
```

QZ Tray 2.1 o posterior se inicia automáticamente al iniciar sesión de Windows.
No hace falta dejar una consola de logs abierta. Si el icono no aparece o el
proceso se cierra solo, abre la consola sólo para diagnosticarlo y conserva las
líneas de error:

```bat
"%ProgramFiles%\QZ Tray\qz-tray-console.exe"
```

No uses el modo `--headless` ni lo conviertas todavía en servicio Windows: en
esta instalación QZ necesita poder mostrar su primera autorización de firma.

### 3.3. Permitir el puerto sólo en la LAN autorizada

En PowerShell **como administrador**, permite el puerto seguro 8181 únicamente
desde los PCs que puedan imprimir. Ejemplo para Administración `192.168.1.20`:

```powershell
New-NetFirewallRule -DisplayName "QZ Tray WSS 8181 desde OpenERP" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8181 `
  -RemoteAddress 192.168.1.20 -Profile Private
```

Añade una regla para cada PC autorizado. No abras este puerto a Internet ni lo
redirecciones en el router.

### 3.4. Confiar en QZ desde los PCs clientes

Copia `C:\ProgramData\qz\ssl\root-ca.crt` desde el PC de caja a cada PC que
abra OpenERP y pueda imprimir remotamente. En cada uno:

1. Haz doble clic en `root-ca.crt`.
2. Pulsa **Instalar certificado**.
3. Elige **Equipo local**.
4. Elige **Colocar todos los certificados en el siguiente almacén**.
5. Selecciona **Entidades de certificación raíz de confianza** y finaliza.

En Firefox, activa además `security.enterprise_roots.enabled` en `about:config`
o importa el certificado en su almacén propio.

### 3.5. Guardar la conexión remota en OpenERP

En **Configuración de la tienda → Terminales POS → Impresión mediante QZ Tray**
guarda:

- **Servidor QZ**: `192.168.1.50`.
- **Puerto seguro de QZ**: `8181`.
- **Nombre de la impresora en Windows**: `POSPrinter POS-80` o el real.

Guarda antes de pulsar **Probar conexión e impresora guardadas**: la prueba usa
la configuración ya almacenada, no los cambios todavía sin guardar.

El destino es común para TPV, Ventas, Devoluciones y Cierres Z; hay una única
impresora de tienda configurada de forma global.

## 4. Quitar las confirmaciones repetidas de QZ

Hay dos certificados distintos:

| Fichero                                       | Dónde queda               | Función                                    |
| --------------------------------------------- | ------------------------- | ------------------------------------------ |
| `root-ca.crt`                                 | PC de caja y PCs clientes | Confiar en la conexión WSS de QZ.          |
| `digital-certificate.txt` y `private-key.pem` | QZ y Ubuntu               | Firmar trabajos y evitar avisos repetidos. |

Instalar `root-ca.crt` no elimina por sí solo los avisos de impresión. Para eso
hay que activar la firma silenciosa en el servidor Ubuntu.

### 4.1. Crear las claves de firma en QZ

En el PC de caja:

1. Abre QZ Tray.
2. Ve a **Advanced → Site Manager**.
3. Pulsa `+` y elige **Create New**.
4. Acepta las confirmaciones de creación, instalación y copia.

En el Escritorio aparecerá `QZ Tray Demo Cert` con:

```text
digital-certificate.txt
private-key.pem
```

Estas claves de demostración sólo sirven para la instalación QZ que las generó:
son adecuadas para esta única caja. Para varios servidores QZ usa un certificado
de firma oficial de QZ.

### 4.2. Instalar las claves en Ubuntu

Transfiere ambos ficheros mediante un medio seguro al servidor. Nunca los subas
al panel, los pegues en una conversación, ni los guardes en Git.

En el checkout de producción:

```bash
cd /home/su_admin/OpenERP
install -d -m 750 deploy/qz-signing
install -m 640 /ruta/segura/digital-certificate.txt deploy/qz-signing/
install -m 640 /ruta/segura/private-key.pem deploy/qz-signing/
id -g
```

`/ruta/segura/` en el ejemplo anterior sólo representa el lugar temporal desde
el que se copiaron las claves al servidor. Si ya existen en
`/home/su_admin/OpenERP/deploy/qz-signing/`, **no hay que copiarlas ni moverlas
otra vez**. Compruébalo sin mostrar su contenido:

```bash
cd /home/su_admin/OpenERP
test -r deploy/qz-signing/digital-certificate.txt && echo "certificado OK"
test -r deploy/qz-signing/private-key.pem && echo "clave OK"
id -g
```

Docker monta el directorio de producción dentro de API, worker y migrate. Las
rutas no son intercambiables:

| Lugar             | Ruta del certificado                                               |
| ----------------- | ------------------------------------------------------------------ |
| Servidor Ubuntu   | `/home/su_admin/OpenERP/deploy/qz-signing/digital-certificate.txt` |
| Contenedor Docker | `/run/secrets/qz-signing/digital-certificate.txt`                  |

`deploy` sólo forma parte de la ruta del **servidor**. Nunca forma parte de la
ruta `/run/secrets/...` interna del contenedor.

Edita `/home/su_admin/OpenERP/.env.production` y añade, sustituyendo `1000` por
el resultado de `id -g`:

```dotenv
OPENERP_HOST_SECRET_GID=1000
OPENERP_QZ_SIGNING_CERTIFICATE_FILE=/run/secrets/qz-signing/digital-certificate.txt
OPENERP_QZ_SIGNING_PRIVATE_KEY_FILE=/run/secrets/qz-signing/private-key.pem
```

En particular, esta ruta es incorrecta y hace fallar el preflight del despliegue:

```dotenv
OPENERP_QZ_SIGNING_CERTIFICATE_FILE=/run/secrets/deploy/qz-signing/digital-certificate.txt
```

Despliega para que API, worker y la comprobación de migración reciban los
ficheros de firma:

```bash
cd /home/su_admin/OpenERP
scripts/deploy-update.sh --branch main
```

La prueba de OpenERP debe mostrar:

```text
Firma silenciosa: activa
```

QZ puede pedir una última vez confiar en el certificado de firma. Elige
**Allow** y **Remember this decision**. Los trabajos posteriores no deben
volver a pedir autorización.

### 4.3. Configuración terminada: lista de comprobación

La instalación queda terminada únicamente cuando se cumplen todos estos puntos:

1. En el PC de caja está abierta la aplicación normal `qz-tray.exe`, con su
   icono en la bandeja de Windows. `qz-tray-console.exe` no queda abierto: sólo
   sirve para `certgen` y diagnóstico.
2. El certificado WSS de QZ incluye la IP fija o el nombre DNS del PC de caja,
   y `root-ca.crt` está instalado en cada PC que abre OpenERP e imprime.
3. El firewall de Windows permite el puerto 8181 únicamente desde esos PCs de
   la LAN.
4. Las claves de firma están en
   `/home/su_admin/OpenERP/deploy/qz-signing/` y las variables de
   `.env.production` usan **sólo** `/run/secrets/qz-signing/...`.
5. Tras cambiar claves o variables se ejecuta el despliegue soportado:

   ```bash
   cd /home/su_admin/OpenERP
   scripts/deploy-update.sh --branch main
   ```

6. Se recarga OpenERP con `Ctrl+F5`, se guarda el destino QZ y la prueba indica
   el nombre de la impresora y **`Firma silenciosa: activa`**.

Si la prueba muestra firma no configurada o QZ identifica la petición como
anónima, no se debe aceptar avisos en cada ticket: revisa el par de ficheros de
firma, sus rutas dentro del contenedor y vuelve a desplegar.

## 5. Comprobación final

1. El botón de prueba encuentra la impresora configurada.
2. Indica **Firma silenciosa: activa** si configuraste el apartado 4.
3. Cobra una venta pequeña y verifica un único ticket cortado.
4. Reimprime esa venta desde **Ventas**.
5. Reimprime un cierre desde **Cierres Z**.
6. Si usas Administración en otro PC, repite una reimpresión desde allí.
7. En la plantilla prueba una venta nueva con `4 mm` a izquierda/derecha y
   `5 mm` arriba/abajo: debe dejar blanco lateral visible y papel antes/después
   del contenido. No uses una venta antigua para validar una plantilla nueva,
   porque su perfil queda congelado al cobrarla.

## 6. Diagnóstico rápido

| Síntoma                                          | Acción                                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No conecta con QZ                                | Comprueba que QZ está abierto, IP/puerto guardados, certificado instalado y firewall 8181.                                                                             |
| La prueba queda comprobando                      | Tras 12 s muestra un error. Responde cualquier aviso de QZ y revisa autorización, firma y red.                                                                         |
| Preflight no encuentra `/run/secrets/deploy/...` | Quita `deploy` de las variables `OPENERP_QZ_SIGNING_*_FILE`: la ruta interna es `/run/secrets/qz-signing/...`.                                                         |
| WSS no confiable                                 | Repite `certgen --host` con la IP real, reinicia QZ y reinstala el nuevo `root-ca.crt`.                                                                                |
| `Acceso denegado` con `certgen`                  | Cierra QZ y abre CMD como administrador; no cambies permisos de `Program Files`.                                                                                       |
| No encuentra impresora                           | Copia el nombre literal de la cola de Windows, no sólo el modelo de la carcasa.                                                                                        |
| QZ pregunta en cada ticket                       | Falta la firma del apartado 4 o el servidor todavía no se ha desplegado.                                                                                               |
| QZ identifica la solicitud como anónima          | El navegador no recibió un certificado de firma válido: verifica ambos ficheros en `deploy/qz-signing/`, las rutas `/run/secrets/qz-signing/...` y despliega de nuevo. |
| Chrome/Edge pregunta por red local               | Es un permiso independiente del navegador; concédelo una vez para el sitio.                                                                                            |
| Sale A4 o diálogo del navegador                  | No es la ruta térmica: revisa que OpenERP y QZ estén desplegados y conectados.                                                                                         |
| Los márgenes no cambian al reimprimir una venta antigua | Es correcto: el ticket conserva su perfil histórico. Cobra una venta nueva para validar la plantilla activa. |

## 7. Mantenimiento y seguridad

- Mantén QZ actualizado y ejecutándose sólo en el PC de caja.
- No expongas el puerto WSS 8181 a Internet.
- Si cambia IP/DNS del PC de caja, repite el apartado 3 y actualiza OpenERP.
- Si rotas las claves de firma, reemplaza ambos ficheros del apartado 4.2 y
  ejecuta el despliegue de nuevo.
- Conserva `private-key.pem` fuera de copias públicas y repositorios.

Referencias: [QZ Print Server](https://qz.io/docs/print-server) y
[firma de mensajes QZ](https://qz.io/docs/signing).
