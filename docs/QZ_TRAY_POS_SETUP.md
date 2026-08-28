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

### 3.2. Permitir el puerto sólo en la LAN autorizada

En PowerShell **como administrador**, permite el puerto seguro 8181 únicamente
desde los PCs que puedan imprimir. Ejemplo para Administración `192.168.1.20`:

```powershell
New-NetFirewallRule -DisplayName "QZ Tray WSS 8181 desde OpenERP" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8181 `
  -RemoteAddress 192.168.1.20 -Profile Private
```

Añade una regla para cada PC autorizado. No abras este puerto a Internet ni lo
redirecciones en el router.

### 3.3. Confiar en QZ desde los PCs clientes

Copia `C:\ProgramData\qz\ssl\root-ca.crt` desde el PC de caja a cada PC que
abra OpenERP y pueda imprimir remotamente. En cada uno:

1. Haz doble clic en `root-ca.crt`.
2. Pulsa **Instalar certificado**.
3. Elige **Equipo local**.
4. Elige **Colocar todos los certificados en el siguiente almacén**.
5. Selecciona **Entidades de certificación raíz de confianza** y finaliza.

En Firefox, activa además `security.enterprise_roots.enabled` en `about:config`
o importa el certificado en su almacén propio.

### 3.4. Guardar la conexión remota en OpenERP

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

Edita `/home/su_admin/OpenERP/.env.production` y añade, sustituyendo `1000` por
el resultado de `id -g`:

```dotenv
OPENERP_HOST_SECRET_GID=1000
OPENERP_QZ_SIGNING_CERTIFICATE_FILE=/run/secrets/qz-signing/digital-certificate.txt
OPENERP_QZ_SIGNING_PRIVATE_KEY_FILE=/run/secrets/qz-signing/private-key.pem
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

## 5. Comprobación final

1. El botón de prueba encuentra la impresora configurada.
2. Indica **Firma silenciosa: activa** si configuraste el apartado 4.
3. Cobra una venta pequeña y verifica un único ticket cortado.
4. Reimprime esa venta desde **Ventas**.
5. Reimprime un cierre desde **Cierres Z**.
6. Si usas Administración en otro PC, repite una reimpresión desde allí.

## 6. Diagnóstico rápido

| Síntoma                            | Acción                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| No conecta con QZ                  | Comprueba que QZ está abierto, IP/puerto guardados, certificado instalado y firewall 8181.     |
| La prueba queda comprobando        | Tras 12 s muestra un error. Responde cualquier aviso de QZ y revisa autorización, firma y red. |
| WSS no confiable                   | Repite `certgen --host` con la IP real, reinicia QZ y reinstala el nuevo `root-ca.crt`.        |
| `Acceso denegado` con `certgen`    | Cierra QZ y abre CMD como administrador; no cambies permisos de `Program Files`.               |
| No encuentra impresora             | Copia el nombre literal de la cola de Windows, no sólo el modelo de la carcasa.                |
| QZ pregunta en cada ticket         | Falta la firma del apartado 4 o el servidor todavía no se ha desplegado.                       |
| Chrome/Edge pregunta por red local | Es un permiso independiente del navegador; concédelo una vez para el sitio.                    |
| Sale A4 o diálogo del navegador    | No es la ruta térmica: revisa que OpenERP y QZ estén desplegados y conectados.                 |

## 7. Mantenimiento y seguridad

- Mantén QZ actualizado y ejecutándose sólo en el PC de caja.
- No expongas el puerto WSS 8181 a Internet.
- Si cambia IP/DNS del PC de caja, repite el apartado 3 y actualiza OpenERP.
- Si rotas las claves de firma, reemplaza ambos ficheros del apartado 4.2 y
  ejecuta el despliegue de nuevo.
- Conserva `private-key.pem` fuera de copias públicas y repositorios.

Referencias: [QZ Print Server](https://qz.io/docs/print-server) y
[firma de mensajes QZ](https://qz.io/docs/signing).
