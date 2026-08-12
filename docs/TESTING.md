# Estrategia de tests

El objetivo es obtener feedback cotidiano en segundos sin retirar cobertura de
las validaciones críticas. PostgreSQL sigue siendo real en todas las pruebas de
integración; no se sustituye por SQLite ni por mocks.

## Niveles

| Nivel | Cuándo | Comando |
| --- | --- | --- |
| **FAST** | Mientras se implementa una modificación | `make test-fast TESTS="tests/archivo.py::test_caso"` |
| **DOMAIN** | Cuando el caso exacto ya está verde | `make test-backend-sales`, `test-backend-pricing`, `test-backend-inventory` o `test-backend-reports` |
| **FULL** | CI, final de un bloque importante o release | `make test`; para la puerta de release completa, `make test-full` |

`test-fast` exige una ruta o nodo de pytest explícito y usa `-x`. Nunca ejecuta
la suite completa como fallback. Los targets de dominio también usan `-x` para
detener una iteración de desarrollo en el primer fallo. La validación amplia
final (`make test`) no usa fail-fast.

Los tests cuyo grafo de fixtures llega a `postgres_server_url`, `database_url`
o `fresh_database` reciben automáticamente la marca `integration`. Por eso:

```bash
make test-backend-unit
```

ejecuta solamente pruebas que no necesitan PostgreSQL. Una sesión de
integración crea una base desechable, aplica `alembic upgrade head` una sola vez
y aísla normalmente cada caso mediante transacción y rollback.

## Backend por dominio

```bash
make test-backend-sales       # ventas, pagos, devoluciones, tickets e histórico
make test-backend-pricing     # fórmula, API de precios e impuestos
make test-backend-inventory   # inventario, lotes, almacenamiento y recepciones
make test-backend-reports     # informes, cierres Z y render de tickets
```

Para combinar varios dominios en una única sesión —y pagar una sola creación de
base y una sola migración— se pasan todas sus rutas en un único `test-fast`.
Durante el cierre de fase se quita `-x` ejecutando directamente el mismo grupo
con `cd backend && uv run pytest -q ...`.

## Migraciones

La comprobación habitual y barata es:

```bash
make test-backend-migrations-fast
```

Comprueba que la base está en `head`, que existe una única cabeza y que modelos
y migraciones están sincronizados. Si se modifica una migración, hay que añadir
durante el desarrollo el nodo o fixture histórica concreta afectada y, al
cerrar la fase, ejecutar una sola vez:

```bash
make test-backend-migrations
```

La suite completa conserva los ciclos de upgrade/downgrade/upgrade y las
fixtures históricas. No debe repetirse en fases que no modifican migraciones.

## Frontend y E2E

```bash
make test-frontend-fast TESTS="src/features/pos/Cart.test.tsx"
make test-frontend

make test-e2e-spec SPEC=tests/e2e/specs/pos.sale.spec.ts
make test-e2e-flow FLOW="cash sale"
make test-e2e
```

Playwright prueba flujos visibles, no sustituye las pruebas backend de stock,
ventas, precios, concurrencia o permisos.

## Política para Codex y desarrollo local

1. Durante una modificación: ejecutar únicamente el nodo exacto relacionado.
2. Cuando esté verde: ejecutar el archivo o pequeño grupo del dominio.
3. Al terminar un commit: dominio afectado más lint/typecheck del lenguaje
   modificado.
4. Al terminar una fase: una única ejecución amplia de los dominios afectados,
   sin `-x`.
5. Migraciones completas: solo si la fase modificó migraciones.
6. E2E: solo si cambió un flujo visible que lo justifique.
7. Suite completa: CI, final de un bloque importante y release.

CI mantiene backend, frontend y E2E como jobs separados. La cobertura crítica
de ventas, pagos, stock, inventario, permisos, concurrencia, histórico,
devoluciones, cierres Z y migraciones permanece en sus suites actuales.
