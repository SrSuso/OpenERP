/** Etiquetas legibles para las columnas que puede devolver cualquier
 * informe — vocabulario fijo y pequeño (coincide 1:1 con las columnas de
 * salida de backend/app/reports/rules.py, que también es una lista
 * blanca cerrada), así que se mapea a mano en vez de intentar
 * "adivinarlo" a partir de la clave. */
export const COLUMN_LABELS: Record<string, string> = {
  date: 'Fecha',
  product_name: 'Producto',
  category_name: 'Categoría',
  warehouse_name: 'Almacén',
  cashier_name: 'Cajero',
  supplier_name: 'Proveedor',
  movement_type: 'Tipo',
  quantity: 'Cantidad',
  revenue: 'Ingresos',
  tickets: 'Nº de tickets',
  lines: 'Nº de líneas',
  cost: 'Coste',
  orders: 'Nº de pedidos',
  movements: 'Nº de movimientos',
};

export function columnLabel(key: string): string {
  return COLUMN_LABELS[key] ?? key;
}
