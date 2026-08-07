# Plan de fases

Orden estricto. Una fase no empieza si la anterior está rota. Al cerrar cada
fase se entrega: qué se implementó, archivos tocados, migraciones, endpoints,
tests añadidos, comandos ejecutados, resultado real de los tests, deuda técnica
y commit.

| # | Fase | Estado |
| --- | --- | --- |
| 0 | Bootstrap del proyecto | ✅ completada |
| 1 | Auth y RBAC | pendiente |
| 2 | Auditoría | pendiente |
| 3 | Productos | pendiente |
| 4 | Precios | pendiente |
| 5 | Proveedores | pendiente |
| 6 | Compras | pendiente |
| 7 | Inventory ledger | pendiente |
| 8 | Lotes y caducidad | pendiente |
| 9 | Recepciones | pendiente |
| 10 | Categorías POS | pendiente |
| 11 | Ventas | pendiente |
| 12 | POS | pendiente |
| 13 | Pagos | pendiente |
| 14 | Devoluciones | pendiente |
| 15 | Tickets | pendiente |
| 16 | Dashboards | pendiente |
| 17 | Notificaciones | pendiente |
| 18 | SMTP / outbox | pendiente |
| 19 | Seguridad | pendiente |
| 20 | Rendimiento | pendiente |
| 21 | Backup / restore | pendiente |
| 22 | Tests completos de aceptación | pendiente |

---

## Fase 0 — Bootstrap

**Objetivo:** que exista un esqueleto ejecutable, migrable y probado, con las
decisiones estructurales ya fijadas, para que las fases siguientes sólo añadan
dominio.

Entregado:

- Monolito modular con un paquete por módulo de dominio (vacíos, documentados
  con la fase en la que se llenan).
- Configuración por entorno (`pydantic-settings`, prefijo `OPENERP_`).
- Logging estructurado JSON con `request_id` propagado por *contextvars*.
- Sobre de error único para toda la API, con `request_id` incluido.
- Motor async de SQLAlchemy, una transacción por petición.
- **Tipos `NUMERIC(18,6)` / `Decimal`** como única forma de declarar dinero y
  cantidades (regla 8), con tests contra PostgreSQL real.
- Alembic con convención de nombres de constraints y revisión ancla.
- Arnés de tests sobre PostgreSQL real, con base de datos desechable por sesión
  y aislamiento por transacción; fixture aparte para tests de concurrencia que
  necesitan *commits* reales (fases 11 y 14).
- Frontend con dos superficies independientes (`/admin`, `/pos`), cliente HTTP
  tipado que valida cada respuesta con Zod.
- Playwright con proyectos separados para panel y TPV (éste con `hasTouch`).
- CI: lint, tipos, migraciones (aplicar, revertir, `alembic check`), tests de
  integración, build del frontend y E2E.

### Decisiones que condicionan fases posteriores

- **Una transacción por petición.** `get_session` hace *commit* al terminar el
  handler y *rollback* ante cualquier excepción, así el checkout de la fase 11
  es atómico sin que cada servicio gestione su transacción.
- **`app/db/registry.py`** es el único punto de importación de modelos: si un
  modelo no está ahí, Alembic no lo ve. El test `alembic check` falla si se
  olvida.
- **Los permisos no viven en el frontend.** Las rutas de React se ocultan por
  comodidad; la comprobación real es de la fase 1 y siempre en el backend.
- **`request_id` y `user_id` en *contextvars*** para que la auditoría de la
  fase 2 no tenga que propagarlos por cada firma.
