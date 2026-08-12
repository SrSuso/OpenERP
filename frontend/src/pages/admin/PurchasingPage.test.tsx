import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthContext';
import { type Product } from '@/features/catalog/api';
import { type Location, type Warehouse } from '@/features/inventory/api';
import { type PurchaseOrder } from '@/features/purchasing/api';
import { type Supplier } from '@/features/suppliers/api';

import { PurchasingPage } from './PurchasingPage';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const ME = {
  id: 1,
  email: 'admin@example.com',
  full_name: 'Admin Uno',
  role: 'ADMIN',
  permissions: ['admin.access', 'purchase.read', 'purchase.manage', 'receiving.manage'],
};

function orderTotal(order: PurchaseOrder): string {
  return order.lines.reduce((sum, line) => sum + Number(line.total), 0).toFixed(6);
}

function stubBackend(options: { failPlaceOnce?: boolean; failReceiptOnce?: boolean } = {}) {
  const supplier: Supplier = {
    id: 1,
    name: 'Distribuciones Ejemplo SL',
    tax_id: null,
    email: null,
    phone: null,
    address: '',
    is_active: true,
  };
  const product: Product = {
    id: 10,
    sku: 'P000010',
    name: 'Agua 1.5L',
    description: '',
    category_id: null,
    category_name: null,
    pos_category_id: null,
    pos_category_name: null,
    pos_display_order: 0,
    base_unit_name: 'UNIT',
    cost: '0.500000',
    list_price: '1.000000',
    tax_rate: '0',
    // Su IVA sale de la categoría, no de la columna suelta: es el caso que
    // tiene que autocompletar la línea de compra.
    effective_tax_rate: '21',
    surcharge_rate: '0',
    margin_rate: null,
    margin_amount: null,
    taxes: [],
    price_formula: null,
    min_stock: '0',
    track_lots: false,
    track_expiration: false,
    tracks_stock: null,
    effective_tracks_stock: true,
    is_active: true,
    packages: [{ id: 100, name: 'Caja de 6', factor: '6', is_base: false, barcodes: [] }],
  };
  const warehouse: Warehouse = { id: 1, name: 'Almacén central', is_active: true };
  const location: Location = { id: 1, warehouse_id: 1, name: 'Recepción', is_active: true };

  const orders: PurchaseOrder[] = [];
  let nextOrderId = 1;
  let nextLineId = 1;
  const receipts: Record<number, unknown[]> = {};
  const placeKeys: string[] = [];
  const receiptKeys: string[] = [];
  let placeFailures = options.failPlaceOnce ? 1 : 0;
  let receiptFailures = options.failReceiptOnce ? 1 : 0;

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const body = () =>
        init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};

      if (url.includes('/auth/me')) return Promise.resolve(jsonResponse(ME));
      if (method === 'GET' && /\/suppliers\?/.test(url))
        return Promise.resolve(jsonResponse([supplier]));
      if (method === 'GET' && /\/products\?/.test(url))
        return Promise.resolve(jsonResponse([product]));
      if (method === 'GET' && /\/warehouses$/.test(url))
        return Promise.resolve(jsonResponse([warehouse]));
      if (method === 'GET' && /\/warehouses\/\d+\/locations/.test(url)) {
        return Promise.resolve(jsonResponse([location]));
      }

      if (method === 'GET' && /\/purchase-orders\?/.test(url)) {
        return Promise.resolve(jsonResponse(orders));
      }
      if (method === 'POST' && /\/purchase-orders$/.test(url)) {
        const b = body();
        const order: PurchaseOrder = {
          id: nextOrderId++,
          supplier_id: b['supplier_id'] as number,
          supplier_name: supplier.name,
          status: 'DRAFT',
          notes: (b['notes'] as string) ?? '',
          ordered_at: null,
          created_at: new Date().toISOString(),
          lines: [],
          total: '0.000000',
        };
        orders.push(order);
        receipts[order.id] = [];
        return Promise.resolve(jsonResponse(order, { status: 201 }));
      }
      const lineMatch = /\/purchase-orders\/(\d+)\/lines$/.exec(url);
      if (method === 'POST' && lineMatch) {
        const order = orders.find((o) => o.id === Number(lineMatch[1]))!;
        const b = body();
        const factor = 6;
        const qty = Number(b['quantity_packages']);
        order.lines.push({
          id: nextLineId++,
          product_id: product.id,
          product_sku: product.sku,
          product_name: product.name,
          package_id: b['package_id'] as number,
          package_name: 'Caja de 6',
          package_factor: '6',
          quantity_packages: b['quantity_packages'] as string,
          quantity_ordered: String(qty * factor),
          quantity_received: '0',
          unit_cost: b['unit_cost'] as string,
          tax_rate: b['tax_rate'] as string,
          discount_rate: b['discount_rate'] as string,
          subtotal: String(qty * Number(b['unit_cost'])),
          discount_amount: '0',
          tax_amount: '0',
          total: String(qty * Number(b['unit_cost'])),
        });
        order.total = orderTotal(order);
        return Promise.resolve(jsonResponse(order, { status: 201 }));
      }
      const placeMatch = /\/purchase-orders\/(\d+)\/place$/.exec(url);
      if (method === 'POST' && placeMatch) {
        placeKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (placeFailures > 0) {
          placeFailures -= 1;
          return Promise.reject(new TypeError('Network request failed'));
        }
        const order = orders.find((o) => o.id === Number(placeMatch[1]))!;
        order.status = 'ORDERED';
        order.ordered_at = new Date().toISOString();
        return Promise.resolve(jsonResponse(order));
      }
      const receiptsMatch = /\/purchase-orders\/(\d+)\/receipts$/.exec(url);
      if (method === 'GET' && receiptsMatch) {
        return Promise.resolve(jsonResponse(receipts[Number(receiptsMatch[1])] ?? []));
      }
      if (method === 'POST' && receiptsMatch) {
        receiptKeys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '');
        if (receiptFailures > 0) {
          receiptFailures -= 1;
          return Promise.reject(new TypeError('Network request failed'));
        }
        const order = orders.find((o) => o.id === Number(receiptsMatch[1]))!;
        const b = body();
        const lines = b['lines'] as {
          purchase_order_line_id: number;
          quantity_packages: string;
          lot_number: string | null;
        }[];
        const receipt = {
          id: 1,
          purchase_order_id: order.id,
          warehouse_id: b['warehouse_id'],
          location_id: b['location_id'],
          notes: b['notes'],
          received_at: new Date().toISOString(),
          lines: lines.map((l, i) => ({
            id: i + 1,
            purchase_order_line_id: l.purchase_order_line_id,
            product_id: product.id,
            product_sku: product.sku,
            quantity_packages: l.quantity_packages,
            lot_id: null,
            lot_number: l.lot_number,
            stock_movement_id: 1,
          })),
        };
        for (const l of lines) {
          const poLine = order.lines.find((pl) => pl.id === l.purchase_order_line_id)!;
          poLine.quantity_received = String(
            Number(poLine.quantity_received) +
              Number(l.quantity_packages) * Number(poLine.package_factor),
          );
        }
        order.status = order.lines.every(
          (l) => Number(l.quantity_received) >= Number(l.quantity_ordered),
        )
          ? 'RECEIVED'
          : 'PARTIALLY_RECEIVED';
        receipts[order.id] = [receipt];
        return Promise.resolve(jsonResponse(receipt, { status: 201 }));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { orders, placeKeys, receiptKeys };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PurchasingPage />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('PurchasingPage', () => {
  it('creates a purchase order, adds a line, places it and receives it', async () => {
    const backend = stubBackend({ failPlaceOnce: true, failReceiptOnce: true });
    renderPage();

    await screen.findByText('No hay pedidos de compra todavía.');

    // Crear pedido — el producto se añade antes de crearlo, no después
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), '1');

    // No se puede crear vacío.
    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeDisabled();
    await screen.findByText('Añade al menos un producto — un pedido no se puede crear vacío.');

    await userEvent.selectOptions(screen.getByLabelText('Producto'), '10');
    // Lo que ese producto vale hoy, para comparar con lo que pide el
    // proveedor sin abrir su ficha.
    expect(screen.getByLabelText('Coste actual')).toHaveValue('0,5');
    expect(screen.getByLabelText('PVP actual')).toHaveValue('1');
    // El IVA sale ya puesto con el del producto, y se puede cambiar.
    expect(screen.getByLabelText('IVA %')).toHaveValue('21');
    await userEvent.selectOptions(screen.getByLabelText('Formato'), '100');
    const qtyInput = screen.getByLabelText('Cantidad');
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '2');
    const costInput = screen.getByLabelText('Coste/ud.');
    await userEvent.clear(costInput);
    await userEvent.type(costInput, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir línea' }));

    await screen.findByText(/P000010 — Caja de 6/);
    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Crear pedido' }));

    await screen.findByText('Distribuciones Ejemplo SL');
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    await screen.findByText('Caja de 6');
    expect(screen.getByText('Realizar pedido')).toBeInTheDocument();

    // Realizar pedido
    await userEvent.click(screen.getByRole('button', { name: 'Realizar pedido' }));
    await waitFor(() => expect(backend.placeKeys).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Realizar pedido' }));
    await screen.findByText('Estado: Realizado');
    expect(backend.placeKeys[0]).not.toBe('');
    expect(backend.placeKeys[1]).toBe(backend.placeKeys[0]);

    // Registrar recepción
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    await userEvent.selectOptions(screen.getByLabelText('Almacén'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Ubicación'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Línea pendiente'), String(1));
    await userEvent.type(screen.getByLabelText('Cantidad'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir a la recepción' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    await screen.findByText('No se ha podido registrar la recepción.');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));

    expect(await screen.findByText('Estado: Recibido')).toBeInTheDocument();
    expect(backend.receiptKeys[0]).not.toBe('');
    expect(backend.receiptKeys[1]).toBe(backend.receiptKeys[0]);
    // Aparece dos veces: una en la tabla de líneas del pedido, otra en la
    // recepción recién registrada.
    expect(screen.getAllByText('P000010')).toHaveLength(2);
  });
});
