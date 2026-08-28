# Editor de plantillas de ticket

OpenERP imprime los tickets sobre una bobina térmica de **80 mm**. La pantalla
**Configuración de la tienda → Plantillas de ticket** permite elegir entre dos
formas de definir el contenido sin cambiar el formato físico de la bobina:

- **Estándar**: se rellenan campos (cabecera, pie, datos fiscales, etiquetas y
  opciones visibles) y OpenERP compone el ticket.
- **Plantilla con variables**: se escribe el contenido con una sintaxis sencilla
  parecida a un editor LaTeX. No es LaTeX real y no admite HTML, JavaScript,
  Python, comandos ni acceso a archivos.

Cambiar de un editor a otro no borra el texto personalizado. Sólo el modo
seleccionado se usa para los tickets nuevos.

## Papel, ancho imprimible y márgenes

La vista previa exterior representa siempre los **80 mm de papel**. La
POSPrinter POS-80 tiene un cabezal de **576 puntos a 203 dpi**, equivalente a
**72 mm imprimibles**. Los 4 mm restantes a cada lado son la zona física entre
el borde de la bobina y el cabezal.

Se pueden modificar:

- margen izquierdo;
- margen derecho;
- margen superior e inferior;
- familia, tamaño, grosor e interlineado de la fuente.

El ancho imprimible no es un control de escala independiente. OpenERP lo
muestra calculado mediante:

```text
ancho útil = 80 mm - margen izquierdo - margen derecho
```

Por ejemplo, `4 + 72 + 4 = 80 mm` utiliza los 576 puntos completos del cabezal.
Al aumentar un margen, OpenERP deja puntos en blanco dentro de esos 576 y reduce
el espacio disponible para el texto. El tamaño de letra no cambia. Los márgenes
no pueden ser inferiores a 4 mm porque esa parte ya queda fuera del cabezal.

La vista previa y la impresión comparten ahora el mismo documento: OpenERP
genera una imagen de **576 puntos de ancho**, la muestra dentro de una bobina de
80 mm y envía esa misma imagen a QZ Tray. Windows y Chrome ya no recalculan el
ancho, los márgenes, la fuente ni el centrado.

### Impresión directa con QZ Tray

La ruta principal de impresión requiere QZ Tray abierto en el ordenador Windows
configurado en **Terminales POS → Impresión mediante QZ Tray**. OpenERP se
conecta al host y puerto WSS guardados, busca el nombre exacto de impresora y
envía la imagen como ESC/POS por la cola RAW de Windows. El trabajo incluye
inicio de impresora, la imagen, avance final y corte.

Antes de la configuración de firma, QZ Tray puede pedir autorización para que
el sitio de OpenERP imprima. En una instalación definitiva la prueba debe
indicar **Firma silenciosa: activa**, de modo que no se aceptan avisos en cada
ticket. Si QZ Tray no está abierto, no encuentra la impresora o Windows rechaza
el trabajo, OpenERP muestra el error y permite reintentar.

No existe una ruta térmica alternativa mediante `window.print()`: un ticket
nuevo, una reimpresión de venta, una Z recién cerrada y una reimpresión de Z
utilizan la misma imagen y el mismo adaptador QZ. Así no pueden reaparecer por
accidente las páginas A4, escalas o márgenes del diálogo de Chrome.

La conexión puede apuntar a `localhost` cuando el TPV y QZ están en el mismo PC,
o a la IP fija del PC de caja para imprimir desde Administración. En el segundo
caso hay que habilitar WSS remoto, instalar la CA de QZ y limitar el firewall y
el origen autorizado. La guía completa, incluida la firma que elimina los
avisos repetidos, está en
[`ADMIN_GUIDE.md`](ADMIN_GUIDE.md#34-la-caja-impresión-térmica-con-qz-tray).

## Editor estándar

Es el modo recomendado cuando sólo se necesita cambiar textos u opciones
habituales. Permite configurar los datos de la tienda, cabecera y pie, formato
de fecha, cajero, precios unitarios, descuentos, IVA y nombres de los métodos de
pago. La vista previa se actualiza mientras se escribe.

## Editor con variables

El texto literal se imprime tal como aparece. Para insertar datos se usa:

```text
{{ variable }}
```

### Variables disponibles

| Grupo | Variables |
| --- | --- |
| Tienda | `store.name`, `store.tax_id`, `store.address`, `store.phone` |
| Plantilla | `template.header`, `template.footer` |
| Venta | `sale.number`, `sale.date`, `sale.cashier` |
| Totales | `totals.subtotal`, `totals.tax`, `totals.total`, `totals.tendered`, `totals.change` |
| Etiquetas | `labels.total`, `labels.change`, `labels.cash`, `labels.card`, `labels.other`, `labels.tax_note` |
| Utilidad | `separator` |

Dentro del bucle de líneas están disponibles `line.name`, `line.quantity`,
`line.unit_price`, `line.total`, `line.discount` y `line.tax_rate`. Dentro de
pagos: `payment.label` y `payment.amount`. Dentro de impuestos: `tax.rate`,
`tax.base` y `tax.amount`.

### Alineación y ancho

Los filtros reservan un número de caracteres, no milímetros:

```text
{{ store.name | center }}
{{ line.name | left:32 }}{{ line.total | right:16 }}
```

Se admiten `left`, `right` y `center`. Sin número usan todo el ancho de la
línea; con `:N` usan exactamente `N` caracteres. Si una línea supera el ancho
permitido por la fuente y el área imprimible, se divide en varias líneas.

### Bucles

```text
{% for line in sale.lines %}
{{ line.name | left:32 }}{{ line.total | right:16 }}
{{ line.quantity }} x {{ line.unit_price }}
{% endfor %}

{% for payment in sale.payments %}
{{ payment.label | left:32 }}{{ payment.amount | right:16 }}
{% endfor %}

{% for tax in sale.taxes %}
{{ tax.rate | left:8 }}{{ tax.base | right:20 }}{{ tax.amount | right:20 }}
{% endfor %}
```

No se permiten bucles anidados, condicionales, cálculos, variables distintas de
las documentadas ni etiquetas sin cerrar. OpenERP valida el diseño antes de
guardarlo y vuelve a usar exactamente las mismas reglas al generar el ticket.

### Ejemplo completo

```text
{{ store.name | center }}
{{ store.tax_id | center }}
{{ separator }}
Venta {{ sale.number }}
{{ sale.date }}
{% for line in sale.lines %}
{{ line.name | left:32 }}{{ line.total | right:16 }}
{{ line.quantity }} x {{ line.unit_price }}
{% endfor %}
{{ separator }}
{{ labels.total | left:32 }}{{ totals.total | right:16 }}
{% for payment in sale.payments %}
{{ payment.label | left:32 }}{{ payment.amount | right:16 }}
{% endfor %}
{{ template.footer | center }}
```

## Guardado, activación e histórico

Guardar modifica la plantilla seleccionada; **Usar esta** decide cuál se aplica
a la siguiente venta. Sólo hay una activa a la vez. Un ticket ya generado
conserva para siempre su texto, ancho, márgenes y fuente, por lo que editar,
activar o eliminar una plantilla no altera una reimpresión histórica.

Antes de usar una plantilla nueva en caja conviene imprimir una venta de prueba
en la impresora real y, si el cabezal corta caracteres, aumentar el margen
correspondiente; OpenERP reducirá automáticamente el ancho útil.
