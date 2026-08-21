# Manual del encargado

El rol inicial `MANAGER` está diseñado para la gestión diaria de una tienda.
Incluye `admin.access` y las capacidades operativas ordinarias, pero no puede
administrar roles, leer la auditoría ni cambiar la configuración funcional
global por defecto.

## Qué puede hacer desde el panel

- Crear, editar, activar y desactivar usuarios, además de preparar su acceso
  TPV, usuario TPV y PIN (`users.manage`).
- Gestionar productos, categorías, unidades, presentaciones, precios,
  impuestos, fórmulas y categorías POS.
- Gestionar proveedores, compras, recepciones, almacenes, ubicaciones, lotes,
  FEFO, saldos, ajustes y transferencias.
- Consultar y gestionar ventas, cierres Z y devoluciones económicas y físicas.
- Gestionar dashboards, avisos, outbox e informes operativos.

Las instrucciones concretas están agrupadas en la
[guía de usuario](../USER_GUIDE.md): inventario y catálogo, compras,
dashboards e informes, y terminales, tickets y avisos.

## Devoluciones desde el TPV

El rol inicial `MANAGER` tiene `return.manage`, por lo que puede procesar una
devolución supervisada. Para hacerlo *desde el TPV* necesita además un usuario
TPV habilitado, PIN y `pos.access`. `pos.access` no forma parte del rol inicial
`MANAGER`; un `ADMIN` debe concederlo al rol o usar un rol personalizado que lo
incluya. Entonces aparecerá **Devolución** en la cabecera del TPV.

## Límites del rol inicial

- No puede crear ni modificar roles o permisos (`roles.manage`).
- No puede consultar la auditoría (`audit.read`).
- No puede ver ni cambiar **Configuración** funcional (`settings.read` y
  `settings.manage`).
- No puede abrir ni gestionar **Terminales POS** (`pos_terminal.manage`) ni
  **Plantillas de ticket** (`ticket.manage`).
- No gestiona secretos, base de datos, SMTP, despliegues, copias ni restores:
  son operación de infraestructura, no permisos del panel.

Un `ADMIN` puede ampliar un rol de encargado si la política de la tienda lo
requiere. Al hacerlo, revisa el permiso concreto en lugar de inferirlo por el
nombre del rol.
