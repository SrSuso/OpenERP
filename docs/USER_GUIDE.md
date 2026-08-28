# Manual de usuario

Esta guía explica las tareas que se realizan desde la interfaz de OpenERP.
No requiere Swagger, comandos ni conocimiento de la base de datos. Las
opciones que ve cada persona dependen de sus permisos; que un enlace no
aparezca no significa que la función no exista.

Antes de seguir una tarea, consulta el manual correspondiente a tu perfil:
[cajero](roles/CASHIER.md), [encargado](roles/MANAGER.md) o
[administrador](roles/ADMIN.md). La referencia de los tres perfiles y de los
roles personalizados está en [Manuales por rol](roles/README.md).

Para instalar, actualizar o recuperar el servidor, consulta
[`ADMIN_GUIDE.md`](ADMIN_GUIDE.md).

---

## 1. Entrar, salir y proteger la cuenta

El panel de administración se abre por la dirección HTTPS facilitada por el
administrador e inicia sesión con correo y contraseña. El TPV tiene su propia
pantalla de acceso, `/pos/login`: se elige un usuario TPV habilitado y se
introduce su PIN en el teclado numérico de la pantalla. No existe registro
público ni recuperación autónoma por email: las cuentas, PIN y
restablecimientos los gestiona una persona con `users.manage`.

- Con `admin.access` se puede entrar al panel `/admin`.
- Con `pos.access`, un usuario TPV, PIN y habilitación expresa se puede entrar
  al TPV `/pos/login`.
- Si se tienen ambos permisos, el acceso administrativo normal prioriza el
  panel; el TPV siempre mantiene una sesión independiente.

Cuando un administrador restablece una contraseña, se cierran las sesiones de
esa cuenta. En el siguiente acceso sólo se muestra **Cambiar contraseña** y no
se permite continuar hasta elegir una contraseña nueva. Esto es distinto de
«he olvidado mi contraseña»: no hay envío de enlaces por correo.

En **Mi cuenta** se puede cambiar la contraseña conociendo la actual y revisar
las sesiones abiertas. Desde allí se puede cerrar una sesión abandonada en
otro equipo. Usa siempre **Salir** o **Cerrar sesión** al terminar en un equipo
compartido.

---

## 2. Punto de venta (TPV)

### 2.1. Terminal y cajero son identidades distintas

Tras el acceso al TPV, el navegador pide seleccionar un terminal activo, como
«Caja 1». La selección queda guardada en ese navegador aunque cambie la
persona que inicia sesión.

- **Terminal**: puesto físico y almacén desde el que sale la mercancía.
- **Cajero**: usuario autenticado que confirma el cobro.

Una venta cobrada conserva ambos datos históricos. El cajero efectivo es quien
pulsa **Confirmar cobro**, aunque otra persona hubiese creado o modificado el
borrador. Renombrar después el usuario o el terminal no cambia el ticket ni los
informes históricos.

Pulsa el nombre del terminal en la cabecera para escoger otro. Si el terminal
guardado se desactiva, la caja bloquea la operativa y conserva sus borradores;
hay que reactivarlo o elegir otro terminal activo. El sistema no implementa
turnos, sesiones de efectivo, presencia ni asignación permanente de personas a
cajas.

### 2.2. Ventas abiertas y aparcadas

El TPV recupera los borradores del terminal seleccionado. Puede haber varios a
la vez: pulsa **Nueva venta**, junto al nombre de la tienda en la cabecera,
para aparcar el actual y atender a otra persona. Si hay más de un borrador,
usa la barra de ventas abiertas para volver a cualquiera de ellos.

Los borradores se guardan en el servidor y sobreviven a una recarga o al cierre
del navegador. No se mezclan con los borradores de otro terminal. No existe una
transferencia supervisada de borradores entre terminales.

### 2.3. Añadir artículos

- Toca un botón del catálogo para añadir su presentación base.
- Usa el multiplicador antes de tocar el producto si necesitas varias unidades.
- Para categorías configuradas para vender al peso, el TPV pide los gramos
  antes de añadir la línea y calcula el importe con el PVP por unidad base.
- Escanea un código de barras sin enfocar ningún campo. Para buscar a mano,
  toca o haz clic directamente en el recuadro **Escanear o introducir código
  de barras**: se abre el buscador de catálogo con teclado táctil. Busca por
  nombre o código de barras y toca el resultado. El administrador puede
  desactivar este buscador para cada terminal.
- Las pestañas de colores filtran las categorías POS.

**Cancelar venta** anula el borrador completo. Para quitar sólo una línea, usa
el control de esa línea.

### 2.4. Cobrar

Pulsa **Cobrar**, elige el método disponible y confirma:

- **Efectivo**: al seleccionarlo se abre después el recuadro **Importe
  recibido**. El teclado recibe céntimos, sin coma: `1250` equivale a `12,50
  €`. Puede dejarse vacío cuando el cliente entrega el importe exacto; el TPV
  calcula el cambio cuando corresponde.
- **Tarjeta**: usa el total exacto.
- **Otro**: sólo aparece si la tienda lo habilitó; puede llamarse Bizum, vale u
  otro nombre configurado.

El servidor vuelve a comprobar venta, terminal, importes y stock antes de
confirmar. Si falla, el borrador permanece abierto sin efectos parciales. Si la
respuesta se pierde y se reintenta el mismo cobro, OpenERP recupera el resultado
ya confirmado en vez de cobrar o descontar stock dos veces.

Por defecto no se permite dejar stock negativo. La tienda puede habilitarlo en
**Configuración**, salvo para productos controlados por lotes: éstos siempre
necesitan un lote disponible. Un producto configurado sin control de
existencias se vende sin comprobar ni mover stock.

### 2.5. Ticket e impresión

Tras el cobro se muestra el total, los pagos y el cambio. Según la configuración
de la tienda, el ticket se imprime automáticamente o mediante **Imprimir
ticket**. Si se repite la impresión se reutiliza el ticket congelado, no se
genera uno con nombres o precios actuales.

La impresión principal usa QZ Tray abierto en el ordenador Windows configurado y
la impresora `POSPrinter POS-80`. La primera vez puede pedir autorización. Si
QZ o la impresora no están disponibles se muestra el motivo y se permite
reintentar. La preparación está en
[`ADMIN_GUIDE.md`](ADMIN_GUIDE.md#34-la-caja-impresión-térmica-con-qz-tray).

Un administrador configura la dirección del PC de impresión, el puerto seguro y
el nombre exacto de la impresora en **Configuración de la tienda → Terminales POS
→ Impresión mediante QZ Tray**. Después de guardar, el botón de prueba confirma
si QZ es accesible, si encuentra la cola y si la firma silenciosa está activa.

La impresión del ticket recién cobrado, las reimpresiones de Ventas y
Devoluciones, el cierre Z y la reimpresión de cierres usan siempre QZ Tray. No
existe una segunda composición del ticket mediante el navegador.

### 2.6. Cerrar caja y sesión

En el TPV, **Cerrar sesión** abre primero el cierre Z del almacén. La vista
previa muestra ventas abiertas y totales pendientes. No se puede cerrar
mientras haya borradores abiertos: hay que cobrarlos o cancelarlos.

Al confirmar se guarda el corte y después se cierra la sesión. El cierre
incluye todas las terminales del almacén, no sólo el navegador actual, y no
puede perder ventas o devoluciones confirmadas durante el cierre. Un reintento
incierto recupera el mismo cierre.

---

## 3. Ventas, tickets y cierres Z

Con `sale.read`, **Ventas** permite filtrar por día comercial y por estado,
consultar terminal, número, total y número de líneas. Las ventas cobradas
ofrecen **Reimprimir**; el texto es exactamente el que quedó guardado al
generarse originalmente.

**Cierres de caja** muestra los cierres Z ya guardados: periodo cubierto,
ventas, efectivo, tarjeta, otros medios, devoluciones y total neto. Son
instantáneas históricas y no cambian si después se registra otra operación.

---

## 4. Devoluciones económicas y físicas

La pantalla **Devoluciones** del panel requiere `return.read`; registrar una
requiere `return.manage`. Un usuario que inicie sesión en el TPV y tenga
`return.manage` verá también **Devolución** en la cabecera de la caja: es el
mismo flujo supervisado, con la sesión POS actual. Los cajeros sin ese permiso
no ven el acceso y el backend también rechaza cualquier intento directo.

Busca una venta cobrada por su número y, para cada línea,
indica dos cantidades independientes:

- **Cantidad a reembolsar**: lo que se devuelve económicamente al cliente.
- **Cantidad que vuelve a stock**: lo que vuelve físicamente al almacén.

Esto permite cuatro casos:

| Caso | Reembolso | Vuelve a stock |
| --- | ---: | ---: |
| Devolución normal | Sí | Sí |
| Producto roto o no recuperado | Sí | No |
| Cambio o reposición sin dinero | No | Sí |
| Cantidades diferentes | Una cantidad | Otra cantidad |

Ejemplo: de una venta de 5 unidades se reembolsan 3 y sólo 1 vuelve en buen
estado. El cliente recibe el importe histórico de 3; el almacén recupera 1.

Si hay reembolso, selecciona el medio ya utilizado:

- `CASH`: efectivo entregado.
- `CARD`: el operador confirma que ya hizo el abono en el datáfono externo.
- `OTHER`: otro medio ya realizado.

OpenERP no está integrado automáticamente con el banco o datáfono. El importe
se calcula desde los precios e impuestos congelados en la venta, no desde el
precio actual. Actualmente los reembolsos que registra el sistema quedan
directamente en estado `COMPLETED`. Una devolución sólo física no crea un
reembolso económico ficticio.

Si el producto controla lotes, la cantidad física exige indicar el lote que
regresa.

---

## 5. Inventario y catálogo

El apartado **Inventario** agrupa productos, categorías, lotes, saldos,
movimientos y almacenes. Los terminales POS se configuran fuera de inventario,
en **Configuración de la tienda → Terminales POS**. Cada pestaña se muestra
según los permisos de lectura correspondientes.

### 5.1. Productos, presentaciones y códigos

Con `product.read` se puede buscar y consultar productos. Con
`product.manage` se pueden crear, editar, desactivar y configurar:

- nombre, descripción, código de barras base, unidad base y stock mínimo;
- categorías de producto y categoría POS;
- control de existencias y seguimiento por lotes;
- imagen;
- presentaciones, como unidad, bandeja o caja, con su factor de equivalencia;
- uno o más códigos de barras por presentación.

La referencia técnica del producto se genera automáticamente y no se muestra
en el uso diario. La unidad base se puede corregir aunque el producto ya tenga
movimientos: es una corrección de etiqueta, por lo que no convierte cantidades,
precios ni movimientos históricos. Si hay que convertir una magnitud real, se
necesita una regularización comercial/inventariable, no usar este selector como
conversor.

Desactivar conserva todo el histórico. Se puede eliminar definitivamente un
alta equivocada sólo mientras no tenga ventas, compras, devoluciones, lotes,
stock ni movimientos; si ya los tiene, se desactiva. En la ficha también
aparecen el precio, sus cambios y el histórico de compra cuando los permisos lo
permiten.

**Categorías** divide la pantalla entre categorías de producto y, al otro lado,
categorías POS y unidades. Las categorías de producto pueden fijar de una vez
control de stock, venta al peso, unidad por defecto, margen, margen fijo,
fórmula e impuestos. Las categorías POS controlan los botones del TPV (nombre,
color, orden e imagen), sin confundirse con la categoría de estantería.

La lista de unidades incluye siempre `KG`, `L` y `UDS`; se pueden añadir,
editar y borrar unidades personalizadas. Borrar una personalizada deja de
proponerla en categorías nuevas y limpia ese valor por defecto, pero los
productos existentes conservan su texto histórico. Las tres unidades estándar
están protegidas para que sigan disponibles.

### 5.2. Saldos, movimientos, ajustes y transferencias

Con `inventory.read`:

- **Saldos** muestra existencias por producto, almacén y ubicación.
- **Movimientos** muestra el historial: recepción, venta, devolución, ajuste,
  merma y cada lado de una transferencia.
- **Almacenes** muestra almacenes y sus ubicaciones.

Con `inventory.manage` se pueden crear y activar/desactivar almacenes y
ubicaciones, registrar ajustes y transferencias entre ubicaciones, y reconstruir
la proyección de saldos desde el historial de movimientos. Una transferencia
real está disponible desde la pantalla de saldos.

El stock se almacena en la unidad base. Las presentaciones convierten la
cantidad antes de crear el movimiento.

### 5.3. Lotes, caducidad y FEFO

Con `lot.read`, **Lotes** permite buscar un producto, consultar números de lote,
fabricación, caducidad y saldo por ubicación. Con `lot.manage` se pueden crear
lotes y preparar una salida FEFO.

FEFO propone primero el lote con caducidad más próxima y deja los lotes sin
fecha para el final. La pantalla permite revisar el plan antes de confirmar una
salida por ajuste o merma. El checkout de un producto trazado aplica también
FEFO. Una recepción o devolución física de un producto trazado registra el
lote correspondiente.

---

## 6. Proveedores, compras y recepciones

**Proveedores** requiere `supplier.read`; crear, editar, desactivar y relacionar
productos requiere `supplier.manage`.

**Compras** requiere `purchase.read` y permite consultar pedidos por estado:
borrador, realizado, recibido parcialmente, recibido o cancelado.

Con `purchase.manage` se puede:

1. crear un pedido para un proveedor;
2. añadir presentaciones, cantidades, coste e impuestos;
3. marcar el pedido como realizado;
4. cancelarlo mientras su estado lo permita.

Con `receiving.manage`, un pedido realizado o recibido parcialmente ofrece
**Registrar recepción**. Se seleccionan almacén y ubicación, fecha y cantidades
recibidas. Para productos trazados se introduce lote, fabricación y caducidad.
La recepción aumenta inventario y actualiza el estado del pedido; admite
recepciones parciales.

Si el coste recibido por unidad base difiere del coste actual del catálogo, la
recepción se guarda igualmente y muestra **Costes de compra diferentes**. Con
`pricing.manage` se pueden seleccionar las líneas y pulsar **Actualizar coste
y recalcular PVP**. La acción toma el coste histórico de la recepción, nunca
un importe escrito en la pantalla, y puede recalcular el PVP cuando el producto
tenga fórmula. No confirmarla no bloquea la mercancía ni cambia el catálogo.

---

## 7. Precios e impuestos

La pantalla **Precios e impuestos** requiere `pricing.manage`.

- **Impuestos** permite crear y modificar tasas. Cambiar una tasa recalcula los
  productos afectados.
- **Fórmula** define el cálculo general de la tienda y permite probarlo antes
  de guardar.
- En cada producto o categoría puede definirse un margen porcentual, un margen
  fijo y una fórmula propia. Un campo vacío hereda categoría y después tienda;
  un cero explícito no significa herencia.
- Cambiar coste, impuestos, margen o fórmula recalcula el precio y registra el
  cambio. También se puede fijar un PVP manual.

El margen fijo se suma al resultado de la fórmula y puede combinarse con el
margen porcentual. La ficha de producto muestra el **PVP calculado (sin
redondear)** y el **PVP de venta (redondeado)**: los precios automáticos se
redondean siempre al alza al siguiente múltiplo de cinco céntimos (`1,53 →
1,55`; `2,16 → 2,20`). Un PVP manual se respeta exactamente. Cambiar el precio
actual nunca modifica ventas, compras o tickets históricos.

Desde la ficha del producto, en la pestaña **Precios**, se pueden cambiar
coste, impuestos y márgenes y revisar ambos PVP. Cambiar el coste recalcula el
PVP automático; fijar un PVP manual lo conserva como precio exacto.

---

## 8. Dashboards e informes

### 8.1. Dashboards privados

Con `dashboard.read`, cada usuario ve únicamente sus propios dashboards. Puede
tener varios y, cuando los hay, aparece **Dashboard activo** para elegir cuál
mostrar. Conocer el UUID o ID de otro usuario no concede acceso y no existe una
función de compartir.

Si la cuenta todavía no tiene ninguno, la pantalla crea automáticamente **Mi
panel**. La UI actual no ofrece un botón para crear un segundo dashboard; el
selector permite alternar entre varios cuando ya existen para esa cuenta.

Con `dashboard.manage` se añaden o quitan widgets de ventas por fecha,
productos más vendidos, valor de inventario y productos bajo mínimo. Los datos
se calculan al abrirlos; la configuración del widget sí queda guardada.

### 8.2. Informes

Con `report.read`, **Informes** permite construir consultas de ventas, compras
y movimientos de inventario escogiendo agrupaciones, métricas y filtros de una
lista cerrada. Con `report.manage` se pueden guardar y eliminar definiciones
para volver a ejecutarlas.

---

## 9. Usuarios, roles y permisos

**Usuarios y roles** muestra cada pestaña sólo si se tiene `users.manage` o
`roles.manage`.

Con `users.manage` se puede crear y editar un usuario, asignarle un rol
permitido, activarlo, desactivarlo, restablecer su contraseña y configurar su
acceso TPV. Para que aparezca en el desplegable de `/pos/login`, debe tener un
rol con `pos.access`, un **Usuario TPV** y un PIN de 4 a 12 dígitos, y estar
marcado como habilitado para TPV. Quitar esa habilitación lo retira del
desplegable sin borrar su histórico. Una persona nunca puede asignar un rol que
contenga permisos que ella misma no posee. Tampoco puede
desactivarse a sí misma ni dejar la instalación sin al menos un administrador
activo capaz de gestionar usuarios y roles.

El restablecimiento administrativo:

1. establece una contraseña temporal;
2. revoca las sesiones existentes;
3. marca `must_change_password`;
4. obliga a cambiarla en el siguiente login.

Crear un usuario nuevo etiqueta la contraseña como provisional, pero en la
versión actual la obligación automática sólo se activa al usar
**Restablecer contraseña**. Comunica la clave inicial por un canal seguro.

Con `roles.manage` se crean roles y se modifica su conjunto completo de
permisos. Los nombres `ADMIN`, `MANAGER` y `CASHIER` son valores iniciales; la
autorización real depende de permisos, no del nombre del rol.

---

## 10. Terminales, tickets, avisos y auditoría

### 10.1. Terminales

Con `pos_terminal.manage`, **Configuración de la tienda → Terminales POS** permite
crear, renombrar, activar y desactivar terminales, y activar o desactivar el
buscador táctil de cada uno. El almacén se elige al crearlos y queda fijo para
no reinterpretar ventas históricas. En esta misma pantalla se ajustan el fondo,
tamaño de letra, botones de cobro, método de pago inicial, refresco de catálogo
e impresión automática del TPV.

### 10.2. Plantillas de ticket

Con `ticket.manage` se crean, revisan, activan y eliminan plantillas. Sólo una
plantilla está activa globalmente. La vista previa conserva siempre los **80
mm** de la bobina y muestra el mismo raster de 576 puntos que se envía mediante
QZ Tray al cabezal de 72 mm. Los márgenes izquierdo/derecho mueven el texto
dentro del cabezal y nunca escalan la letra. También se configuran
fuente, tamaño, interlineado, márgenes verticales, datos de tienda y campos
visibles.

El selector **Tipo de editor** ofrece el modo **Estándar**, basado en campos, y
el modo **Plantilla con variables**, con una sintaxis segura parecida a LaTeX
para controlar cada línea. Cambiar de modo no borra el diseño personalizado.
La sintaxis, todas las variables y ejemplos están en
[`TICKET_TEMPLATE_EDITOR.md`](TICKET_TEMPLATE_EDITOR.md).

Guardar modifica la plantilla actual y activar una desactiva la anterior. El
largo se calcula automáticamente; no se fija una altura para no cortar líneas.
Una plantilla se puede eliminar incluso si generó tickets: cada ticket guarda
su texto y perfil de impresión congelados, por lo que las reimpresiones no
cambian.

### 10.3. Avisos y correo

Con `notification.read` se consultan reglas e incidencias; con
`notification.manage` se crean reglas, se evalúan y se resuelven incidencias.
El contador del menú señala las abiertas.

Con `job.read`, **Correo enviado** muestra mensajes pendientes, enviados o
fallidos. `job.manage` permite pedir un procesamiento manual. Esta pantalla no
configura servidor, usuario o contraseña SMTP: eso es infraestructura.

### 10.4. Auditoría

Con `audit.read`, **Auditoría** permite filtrar acciones sensibles. Es un
registro de consulta; no permite alterar los eventos.

---

## 11. Configuración funcional de la tienda

La pantalla **Configuración** requiere `settings.read`; guardar requiere
`settings.manage`. Sólo contiene opciones funcionales almacenadas en
PostgreSQL, entre ellas:

- nombre visible de la tienda y `business.timezone`;
- reglas de venta, actualización del catálogo y métodos del TPV;
- stock negativo y descuento máximo;
- stock mínimo por defecto;
- textos de avisos;
- tamaño de letra y colores del panel.

Los ajustes específicamente de caja (pantalla, botones de cobro, buscador por
terminal e impresión automática) viven en **Terminales POS**. Los datos y el
perfil de impresión del ticket viven en **Plantillas de ticket**. Esta
separación evita que una misma opción aparezca en varios sitios.

`business.timezone` es la zona horaria comercial usada para mostrar, filtrar y
agrupar ventas, recepciones, devoluciones, auditoría, tickets, dashboards e
informes. Los instantes históricos no se modifican al cambiarla, pero una
operación cercana a medianoche puede pasar a otro día comercial al
reinterpretarse con la nueva zona.

La pantalla nunca configura URL de base de datos, pool, CORS, cookies, rate
limit, bootstrap ni credenciales SMTP. Esos parámetros pertenecen al entorno de
producción y se explican en `ADMIN_GUIDE.md`.

---

## 12. Preguntas frecuentes

**¿Por qué no veo una opción del menú?**

Tu rol no tiene el permiso de lectura correspondiente. Pide a quien gestione
roles que compruebe los permisos; cambiar sólo el nombre del rol no da acceso.

**¿Puedo borrar una venta cobrada?**

No. Registra una devolución con los efectos económico y físico adecuados.

**¿Qué hago si olvidé la contraseña?**

Pide un restablecimiento administrativo. No existe recuperación autónoma por
email.

**¿Puedo mover un borrador de una caja a otra?**

No. Los borradores pertenecen al terminal que los creó.

**¿La tarjeta se reembolsa automáticamente?**

No. Realiza primero el reembolso en el datáfono y después regístralo como
`CARD`.
