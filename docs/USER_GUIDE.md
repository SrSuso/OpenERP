# Manual de usuario

Cómo usar OpenERP en el día a día: iniciar sesión, cobrar en el punto de
venta (TPV) y usar el panel de administración. No hace falta ningún
conocimiento técnico. Si algo de esto no funciona como se describe aquí,
o no tienes un usuario todavía, contacta con quien administra el sistema
en tu tienda (ver [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) si esa persona eres tú).

---

## 1. Iniciar sesión

Abre en el navegador la dirección que te haya dado tu administrador (por
ejemplo `https://openerp.tuempresa.local`). Verás la pantalla de inicio de
sesión con dos campos: correo electrónico y contraseña.

- Si tu cuenta es de **cajero**, tras entrar irás directamente al **TPV**.
- Si tu cuenta es de **administrador o encargado**, irás al **panel de
  administración**.

No hay forma de registrarse por tu cuenta — las cuentas las crea un
administrador. Si no tienes credenciales, pídeselas a esa persona.

La sesión se mantiene abierta mientras la usas y expira sola tras 30 días
sin actividad. Para cerrarla tú mismo (por ejemplo, al terminar tu turno en
un TPV compartido), usa el botón **Salir** / **Cerrar sesión** — es
importante usar ese botón y no sólo cerrar la pestaña, especialmente en un
terminal que usan varias personas.

> **La primera vez que accedes a la aplicación**, el navegador puede avisar
> de que "la conexión no es privada" o "el certificado no es válido". Es
> normal en una red interna sin conexión a internet pública — tu
> administrador te dirá si hay que instalar un certificado en tu equipo o
> si basta con aceptar el aviso ("Avanzado → continuar de todos modos").

---

## 2. El punto de venta (TPV) — `/pos`

Pantalla táctil pensada para cobrar rápido, a pantalla completa.

### 2.1. La venta en curso

Al entrar, se retoma automáticamente la venta que tuvieras abierta (si
recargas la página o si la cerraste sin cobrar, sigue ahí) o se abre una
nueva si no había ninguna.

### 2.2. Añadir productos

- **Tocando la rejilla**: cada toque añade una unidad de ese producto al
  ticket. Las pestañas de arriba filtran por categoría.
- **Con el lector de código de barras**: apunta al código y dispara —
  añade la línea correspondiente automáticamente, sin tocar la rejilla.
  El mismo campo también acepta escribir el código a mano y pulsar Intro.

### 2.3. Cancelar la venta

El botón **Cancelar venta** anula el ticket completo (no se puede deshacer)
y abre uno nuevo automáticamente. Si sólo quieres quitar un producto, usa el
control de esa línea en concreto — no hace falta cancelar todo el ticket.

### 2.4. Cobrar

Pulsa **Cobrar** y elige el método:

- **Efectivo**: escribe el importe recibido; el cambio se calcula al
  momento, según lo vas escribiendo.
- **Tarjeta**: el importe es el total exacto, no hay cambio.

Al confirmar:

- Si todo va bien, la venta se cierra, se muestra un recibo en pantalla con
  el cambio a entregar, y se abre automáticamente un ticket nuevo para la
  siguiente venta.
- Si no hay stock suficiente de algún producto, o el importe no cubre el
  total, se rechaza con un aviso claro y **el ticket sigue abierto tal cual
  estaba** — no se pierde nada, puedes corregir y volver a intentarlo.

### 2.5. Imprimir el ticket

Desde la propia pantalla de confirmación de cobro, **Imprimir ticket** abre
el diálogo de impresión del navegador con el recibo ya formateado (58 o
80mm, según la impresora configurada). Si el botón da un error en vez de
imprimir, avisa a tu administrador — normalmente significa que no hay una
plantilla de ticket activa configurada.

---

## 3. El panel de administración — `/admin`

Pensado para encargados y administradores: gestión general de la tienda y
seguimiento del negocio mediante indicadores.

### 3.1. Mi panel

Al entrar la primera vez se crea automáticamente tu panel personal, vacío.
Cada usuario tiene el suyo — lo que añadas o quites no afecta al de otros
compañeros.

### 3.2. Añadir un indicador (widget)

Botón **Añadir widget** → elige uno de los disponibles:

- **Ventas por día** — evolución de ventas en un rango de fechas.
- **Productos más vendidos** — ranking por cantidad o importe.
- **Valor de inventario** — cuánto vale el stock actual.
- **Productos bajo mínimo** — qué hay que reponer.

Cada uno tiene sus propios filtros (rango de fechas, almacén/tienda si
gestionas más de uno). Los datos se consultan al momento cada vez que ves
el panel — nunca es información guardada de antes, así que siempre refleja
la situación actual.

### 3.3. Quitar un widget

Cada widget tiene su propio control para retirarlo del panel. Se quita sin
más — no hay confirmación adicional ni forma de deshacerlo, aunque puedes
volver a añadir el mismo indicador cuando quieras.

### 3.4. Usuarios (si tienes permiso)

Enlace **Usuarios y roles** en el menú lateral — sólo lo ves si tu cuenta
puede gestionar personal o roles (`ADMIN` o `MANAGER`). Dentro, pestaña
**Usuarios** (siempre presente si ves la sección):

- **Nuevo usuario**: email, nombre, una contraseña provisional y el rol
  (cajero, encargado...). Dile a esa persona que la cambie en cuanto entre
  la primera vez (§4).
- Cambiar el rol de alguien: el desplegable de la columna «Rol» de su fila.
- **Desactivar**: la persona deja de poder iniciar sesión, pero su
  histórico (ventas, movimientos...) no se pierde — nunca se borra a
  nadie. No puedes desactivar tu propia cuenta desde aquí.

### 3.5. Roles y permisos (sólo `ADMIN`)

Dentro de **Usuarios y roles**, pestaña **Roles** — sólo aparece con
permiso para gestionar roles (por defecto, únicamente `ADMIN`; un
`MANAGER` sólo ve la pestaña Usuarios). Desde ahí puedes crear un rol nuevo (por
ejemplo "Encargado de almacén") y marcar qué puede hacer cada uno, casilla
a casilla. Cambia el conjunto completo de permisos de ese rol — no hay
"añadir uno más", cada guardado deja el rol exactamente con lo que esté
marcado en ese momento.

### 3.6. Gestión de productos, compras, proveedores...

Estas áreas todavía no tienen pantallas propias en el panel — las gestiona
tu administrador directamente. Si necesitas dar de alta un producto, un
proveedor o un pedido de compra, pídeselo a la persona que administra el
sistema.

---

## 4. Cambiar tu contraseña

Enlace **Mi cuenta** en el menú lateral de `/admin` (visible para
cualquiera con acceso al panel): pide tu contraseña actual y la nueva dos
veces. Si entraste con una contraseña provisional que te dio un
administrador, cámbiala aquí lo antes posible — es el primer paso
recomendado tras tu primer inicio de sesión.

---

## 5. Preguntas frecuentes

**¿Por qué no puedo entrar en `/admin` si mi cuenta es de cajero?**
Tu cuenta sólo tiene permiso para el TPV. Si necesitas acceso al panel,
tiene que dártelo un administrador cambiando tu rol o tus permisos.

**Cobré algo por error, ¿puedo deshacerlo?**
Una venta ya cobrada no se cancela — se gestiona como una devolución.
Pídesela a quien tenga permiso de devoluciones en tu tienda.

**El TPV dice que no hay stock suficiente pero sé que sí hay producto en la tienda.**
Puede que el inventario del sistema no esté actualizado (por ejemplo, si
falta registrar una recepción de mercancía reciente). Avisa a tu
administrador — no fuerces la venta de otra forma.

**¿Qué hago si se me olvidó la contraseña?**
No hay recuperación automática por correo — pídele a un administrador que
te la cambie.
