# Manual del cajero

El rol inicial `CASHIER` está pensado para atender ventas desde el punto de
venta. No da acceso al panel administrativo.

## Antes de empezar

Un administrador o encargado con `users.manage` debe configurar en la cuenta:

1. un rol con `pos.access` (el rol inicial `CASHIER` ya lo tiene);
2. **Usuario TPV** y un PIN de 4 a 12 dígitos;
3. acceso TPV habilitado.

El cajero entra en `/pos/login`, elige su usuario TPV, introduce el PIN y
selecciona el terminal físico. El terminal queda asociado al navegador; el
cajero es quien confirma realmente el cobro.

## Qué puede hacer

- Crear, recuperar, modificar y cancelar borradores de venta en su terminal.
- Añadir productos por botón, buscador táctil, código de barras o peso cuando
  corresponda.
- Cobrar con los medios configurados, indicar efectivo recibido en céntimos e
  imprimir/reimprimir el ticket de una venta.
- Cerrar sesión mediante el cierre Z, siempre que no existan borradores
  pendientes en el almacén del terminal.
- Consultar el catálogo y la información de stock/lotes que necesita el TPV.

El procedimiento de cada pantalla está en [Punto de venta](../USER_GUIDE.md#2-punto-de-venta-tpv).

## Qué no puede hacer por defecto

- Entrar en `/admin` ni modificar productos, precios, proveedores, compras,
  inventario o terminales.
- Procesar devoluciones: `return.read` y `return.manage` son acciones de
  supervisión y el rol inicial no las recibe.
- Gestionar usuarios, roles, plantillas, informes, avisos, correo, auditoría o
  configuración de la tienda.

Si la tienda decide conceder más permisos a un rol personalizado, el menú y el
backend habilitarán únicamente esas capacidades adicionales. Un cajero no debe
usar la cuenta ni el PIN de otra persona: las ventas guardan el cajero efectivo
que pulsa el checkout.
