# Manual del administrador

El rol inicial `ADMIN` recibe todos los permisos funcionales de OpenERP. Está
reservado para propiedad o administración de confianza, no para una cuenta de
caja cotidiana.

## Qué puede hacer

- Todo lo indicado en los manuales de [cajero](CASHIER.md) y
  [encargado](MANAGER.md), si su cuenta tiene también acceso TPV habilitado,
  usuario TPV y PIN.
- Crear, editar y desactivar usuarios; restablecer contraseñas; habilitar o
  revocar acceso TPV.
- Crear roles y asignar su conjunto de permisos (`roles.manage`). Nadie puede
  asignar permisos que no posea ni eliminar la última vía administrativa de
  recuperación.
- Consultar la auditoría y configurar los ajustes funcionales de la tienda:
  nombre, zona horaria, reglas comerciales, avisos y preferencias del TPV.
- Crear y configurar terminales POS, además de crear, revisar, activar y
  eliminar plantillas de ticket.
- Acceder a todas las áreas operativas: catálogo, precios, compras,
  inventario, ventas, devoluciones, cierres, tickets, dashboards, informes,
  avisos y outbox.

La guía detallada para cada tarea de interfaz está en
[`../USER_GUIDE.md`](../USER_GUIDE.md). La gestión de usuarios y roles se
explica también en [`../ADMIN_GUIDE.md`](../ADMIN_GUIDE.md#5-gestión-de-usuarios-y-roles).
El funcionamiento de los dos editores de ticket, los márgenes de 80 mm y todas
las variables disponibles está en
[`../TICKET_TEMPLATE_EDITOR.md`](../TICKET_TEMPLATE_EDITOR.md).
La instalación de QZ Tray, la impresora Windows, la impresión remota y la firma
silenciosa están en [`../QZ_TRAY_POS_SETUP.md`](../QZ_TRAY_POS_SETUP.md).

## Límites importantes

`ADMIN` no concede acceso a secretos ni convierte el panel en una consola de
infraestructura. URL de PostgreSQL, contraseñas, SMTP, cookies, CORS, proxy,
despliegue, backup, restore y rollback se operan fuera de la interfaz siguiendo
[`../ADMIN_GUIDE.md`](../ADMIN_GUIDE.md). No los guardes en la configuración
funcional ni en un rol.

Usa una cuenta administrativa separada de las cuentas de caja cuando sea
posible. Las sesiones administrativa y TPV son independientes y las acciones
registran el usuario autenticado que las ejecuta.
