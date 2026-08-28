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

La vista previa exterior representa siempre los **80 mm de papel**. Dentro de
ella, el área punteada representa el texto que puede imprimir el cabezal.

Se pueden modificar:

- margen izquierdo;
- ancho imprimible;
- margen derecho;
- margen superior e inferior;
- familia, tamaño, grosor e interlineado de la fuente.

La regla es:

```text
margen izquierdo + ancho imprimible + margen derecho <= 80 mm
```

Por ejemplo, `4 + 72 + 4 = 80 mm`. Al subir el margen izquierdo, el texto se
desplaza a la derecha dentro de la misma bobina; la vista previa no cambia a A4
ni adquiere una barra de desplazamiento horizontal.

OpenERP genera un único documento de impresión aislado del resto de la página.
OpenERP envía el mismo modelo físico que funciona desde LibreOffice: una página
explícita de 80 mm y los márgenes de la plantilla dentro de ella. Por ejemplo,
`4 + 72 + 4 mm` produce exactamente 72 mm de contenido, sin dejar que Chrome o
el controlador deduzcan otra anchura. El alto de la página se calcula con las
líneas reales, el interlineado y los márgenes verticales; no se fijan 200 mm que
puedan alimentar papel en blanco. La impresora corta al terminar ese documento.

### Configuración del controlador de impresión

El navegador no puede cambiar de forma fiable el tamaño configurado en una
impresora. Para imprimir en la térmica hay que seleccionar en el diálogo o en
su controlador:

- la impresora térmica real;
- papel, recibo o bobina de **80 mm**;
- orientación vertical;
- escala **100 %** o **tamaño real**, nunca «ajustar a página»;
- márgenes adicionales del controlador **ninguno**;
- cabeceras y pies del navegador desactivados.

OpenERP controla la página exterior de 80 mm, el ancho de contenido, los
márgenes, la fuente, el interlineado y el alto necesario. El controlador
controla el cabezal y el corte. No configures otros márgenes ni una reducción de
escala en el controlador: volvería a estrechar el documento ya dimensionado.

Si se selecciona «Microsoft Print to PDF» u otra impresora configurada como A4,
la vista del sistema mostrará una hoja A4. Eso describe el papel del destino
seleccionado, no el documento que recibirá una impresora térmica configurada a
80 mm. Para comprobar el resultado real debe seleccionarse la térmica y revisar
que el papel sea 80 mm y la escala 100 %.

La vista previa del editor sí representa siempre los 80 mm nominales y permite
comprobar cómo se mueve el texto al cambiar los parámetros, pero la prueba final
debe hacerse con el controlador y el cabezal que se utilizarán en caja.

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
correspondiente o reducir el ancho imprimible.
