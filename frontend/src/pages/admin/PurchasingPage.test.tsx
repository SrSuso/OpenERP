import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/features/auth/AuthProvider';
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
  permissions: [
    'admin.access',
    'purchase.read',
    'purchase.manage',
    'receiving.manage',
    'pricing.manage',
  ],
};

function orderTotal(order: PurchaseOrder): string {
  return order.lines.reduce((sum, line) => sum + Number(line.total), 0).toFixed(6);
}

function stubBackend(
  options: { failPlaceOnce?: boolean; failReceiptOnce?: boolean; costProposal?: boolean } = {},
) {
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
    packages: [{ id: 100, name: 'Unidad', factor: '1', is_base: true, barcodes: [] }],
  };
  const warehouse: Warehouse = { id: 1, name: 'Almacén central', is_active: true };
  const location: Location = { id: 1, warehouse_id: 1, name: 'Recepción', is_active: true };

  const orders: PurchaseOrder[] = [];
  let nextOrderId = 1;
  let nextLineId = 1;
  const receipts: Record<number, unknown[]> = {};
  const placeKeys: string[] = [];
  const receiptKeys: string[] = [];
  const appliedCosts: unknown[] = [];
  let placeFailures = options.failPlaceOnce ? 1 : 0;
  let receiptFailures = options.failReceiptOnce ? 1 : 0;

  const lineFromBody = (b: Record<string, unknown>) => {
    const qty = Number(b['quantity_packages']);
    const cost = Number(b['unit_cost']);
    const discountRate = Number(b['discount_rate']);
    const taxRate = Number(b['tax_rate']);
    const subtotal = qty * cost;
    const discount = (subtotal * discountRate) / 100;
    const net = subtotal - discount;
    const tax = (net * taxRate) / 100;
    return {
      id: nextLineId++,
      product_id: product.id,
      product_sku: product.sku,
      product_name: product.name,
      package_id: b['package_id'] as number,
      package_name: 'Unidad',
      package_factor: '1',
      quantity_packages: b['quantity_packages'] as string,
      quantity_ordered: String(qty),
      quantity_received: '0',
      unit_cost: b['unit_cost'] as string,
      tax_rate: b['tax_rate'] as string,
      discount_rate: b['discount_rate'] as string,
      subtotal: String(subtotal),
      discount_amount: String(discount),
      tax_amount: String(tax),
      total: String(net + tax),
    };
  };

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
      if (method === 'POST' && /\/products\/\d+\/pricing\/cost-preview$/.test(url)) {
        const cost = Number(body()['cost']);
        const calculated = cost * 2;
        return Promise.resolve(
          jsonResponse({
            calculated_price: String(calculated),
            rounded_price: String(Math.ceil(calculated * 20 - 1e-9) / 20),
          }),
        );
      }
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
          lines: (b['lines'] as Record<string, unknown>[] | undefined)?.map(lineFromBody) ?? [],
          total: '0.000000',
        };
        order.total = orderTotal(order);
        orders.push(order);
        receipts[order.id] = [];
        return Promise.resolve(jsonResponse(order, { status: 201 }));
      }
      const lineMatch = /\/purchase-orders\/(\d+)\/lines$/.exec(url);
      if (method === 'POST' && lineMatch) {
        const order = orders.find((o) => o.id === Number(lineMatch[1]))!;
        const b = body();
        order.lines.push(lineFromBody(b));
        order.total = orderTotal(order);
        return Promise.resolve(jsonResponse(order, { status: 201 }));
      }
      const updateLineMatch = /\/purchase-orders\/(\d+)\/lines\/(\d+)$/.exec(url);
      if (method === 'PUT' && updateLineMatch) {
        const order = orders.find((o) => o.id === Number(updateLineMatch[1]))!;
        const index = order.lines.findIndex((line) => line.id === Number(updateLineMatch[2]));
        const updated = { ...lineFromBody(body()), id: order.lines[index]!.id };
        order.lines[index] = updated;
        order.total = orderTotal(order);
        return Promise.resolve(jsonResponse(order));
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
            product_name: product.name,
            quantity_packages: l.quantity_packages,
            lot_id: null,
            lot_number: l.lot_number,
            stock_movement_id: 1,
          })),
          cost_proposals: options.costProposal
            ? [
                {
                  receipt_line_id: 1,
                  product_id: product.id,
                  product_sku: product.sku,
                  product_name: product.name,
                  current_catalog_cost: '0.500000',
                  received_unit_cost: '0.600000',
                  difference: '0.100000',
                },
              ]
            : [],
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
      const applyCostsMatch = /\/goods-receipts\/(\d+)\/apply-costs$/.exec(url);
      if (method === 'POST' && applyCostsMatch) {
        appliedCosts.push(body());
        const receipt = (receipts[Number(applyCostsMatch[1])] ?? [])[0] as Record<string, unknown>;
        receipt['cost_proposals'] = [];
        product.cost = '0.600000';
        product.list_price = '1.200000';
        return Promise.resolve(jsonResponse(receipt));
      }

      return Promise.reject(new Error(`Unexpected fetch to ${method} ${url} in test`));
    }),
  );

  return { orders, placeKeys, receiptKeys, appliedCosts };
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

    await userEvent.type(screen.getByLabelText('Producto'), 'Agua 1.5L');
    // Lo que ese producto vale hoy, para comparar con lo que pide el
    // proveedor sin abrir su ficha.
    expect(screen.getByLabelText('Coste actual')).toHaveValue('0,5');
    expect(screen.getByLabelText('PVP actual')).toHaveValue('1');
    // El IVA sale ya puesto con el del producto, y se puede cambiar.
    expect(screen.getByLabelText('IVA %')).toHaveValue('21');
    // La elección rellena el coste inicial en un efecto; esperamos a que
    // termine antes de sustituirlo por la cotización del proveedor.
    await waitFor(() => expect(screen.getByLabelText('Coste/unidad')).toHaveValue('0,5'));
    const qtyInput = screen.getByLabelText('Cantidad');
    await userEvent.clear(qtyInput);
    await userEvent.type(qtyInput, '2');
    const costInput = screen.getByLabelText('Coste/unidad');
    await userEvent.clear(costInput);
    await userEvent.type(costInput, '3,25');
    expect(costInput).toHaveValue('3,25');
    await waitFor(() => expect(screen.getByLabelText('PVP previsto')).toHaveValue('6,50 €'));
    await userEvent.click(screen.getByRole('button', { name: 'Añadir fila' }));

    await screen.findByText(/Agua 1\.5L — UNIT/);
    // La tabla previa al alta también es editable: no hace falta quitar la
    // fila para corregir una cotización recién tecleada.
    const stagedCostInput = screen.getByLabelText('Coste por unidad de Agua 1.5L — UNIT');
    await userEvent.clear(stagedCostInput);
    await userEvent.type(stagedCostInput, '1,25');
    await waitFor(() => expect(screen.getAllByText('2,50 €')).not.toHaveLength(0));
    expect(screen.getByRole('button', { name: 'Crear pedido' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Crear pedido' }));

    await screen.findByText('Distribuciones Ejemplo SL');
    expect(backend.orders[0]?.lines[0]?.unit_cost).toBe('1.25');
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));

    expect(await screen.findByText('Realizar pedido')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Unidad' })).toBeInTheDocument();

    // El borrador se corrige directamente en la tabla: al salir de la
    // celda se guarda sin abrir otro formulario.
    const editCostInput = screen.getByLabelText('Coste por unidad de Agua 1.5L');
    await userEvent.clear(editCostInput);
    await userEvent.type(editCostInput, '1');
    await userEvent.tab();
    await waitFor(() => expect(backend.orders[0]?.lines[0]?.unit_cost).toBe('1'));

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
    const receivedQuantity = screen.getByLabelText('Cantidad recibida de Agua 1.5L');
    expect(receivedQuantity).toHaveValue('2');
    await userEvent.clear(receivedQuantity);
    await userEvent.type(receivedQuantity, '1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    await screen.findByText('No se ha podido registrar la recepción.');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));

    expect(await screen.findByText('Estado: Recibido parcialmente')).toBeInTheDocument();
    expect(backend.receiptKeys[0]).not.toBe('');
    expect(backend.receiptKeys[1]).toBe(backend.receiptKeys[0]);
    // Al abrir la segunda recepción sólo queda una unidad pendiente y ya
    // aparece escrita: no hace falta volver a elegir ni añadir la línea.
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    await userEvent.selectOptions(screen.getByLabelText('Almacén'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Ubicación'), '1');
    expect(screen.getByLabelText('Cantidad recibida de Agua 1.5L')).toHaveValue('1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));

    expect(await screen.findByText('Estado: Recibido')).toBeInTheDocument();
    expect(backend.receiptKeys[2]).not.toBe(backend.receiptKeys[0]);
    // La línea del pedido sigue identificando el producto por su nombre;
    // el SKU técnico no se enseña.
    expect(screen.getByText('Agua 1.5L')).toBeInTheDocument();
    expect(screen.queryByText('P000010')).not.toBeInTheDocument();
    expect(screen.queryByText('Costes de compra diferentes')).not.toBeInTheDocument();
  });

  it('shows a received-cost proposal and confirms only selected receipt lines', async () => {
    const backend = stubBackend({ costProposal: true });
    renderPage();

    await screen.findByText('No hay pedidos de compra todavía.');
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo pedido' }));
    await userEvent.selectOptions(screen.getByLabelText('Proveedor'), '1');
    await userEvent.type(screen.getByLabelText('Producto'), 'Agua 1.5L');
    await userEvent.clear(screen.getByLabelText('Cantidad'));
    await userEvent.type(screen.getByLabelText('Cantidad'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir fila' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear pedido' }));
    await screen.findByText('Distribuciones Ejemplo SL');
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    await userEvent.click(screen.getByRole('button', { name: 'Realizar pedido' }));
    await screen.findByText('Estado: Realizado');

    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));
    await userEvent.selectOptions(screen.getByLabelText('Almacén'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Ubicación'), '1');
    expect(screen.getByLabelText('Cantidad recibida de Agua 1.5L')).toHaveValue('1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar recepción' }));

    expect(await screen.findByText('Costes de compra diferentes')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Actualizar coste de Agua 1.5L'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Actualizar coste y recalcular PVP' }),
    );
    await waitFor(() =>
      expect(backend.appliedCosts).toEqual([
        { lines: [{ receipt_line_id: 1, expected_current_cost: '0.500000' }] },
      ]),
    );
  });
});
