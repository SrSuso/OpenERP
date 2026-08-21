# Manuales por rol

OpenERP autoriza por permisos, no por el nombre del rol. Estos tres manuales
describen los permisos de los roles iniciales de una instalación nueva y sirven
para decidir qué cuenta necesita cada persona:

| Perfil | Manual | Uso habitual |
| --- | --- | --- |
| Cajero | [CASHIER.md](CASHIER.md) | Cobrar desde el TPV. |
| Encargado | [MANAGER.md](MANAGER.md) | Operación diaria de la tienda. |
| Administrador | [ADMIN.md](ADMIN.md) | Acceso total, permisos y configuración funcional. |

Un rol personalizado puede combinar permisos de varios perfiles. En ese caso
consulta el manual de cada capacidad concedida y la pantalla **Roles**: la
autoridad efectiva es siempre la lista de permisos mostrada allí.

Los procedimientos detallados por tarea están en
[`../USER_GUIDE.md`](../USER_GUIDE.md). La operación del servidor (despliegue,
backup y restore) está exclusivamente en
[`../ADMIN_GUIDE.md`](../ADMIN_GUIDE.md), incluso para un `ADMIN`.
