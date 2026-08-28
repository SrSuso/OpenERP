import { beforeEach, describe, expect, it, vi } from 'vitest';

const qzMocks = vi.hoisted(() => ({
  isActive: vi.fn(() => true),
  connect: vi.fn(() => Promise.resolve()),
  find: vi.fn(() => Promise.resolve('POSPrinter POS-80')),
  create: vi.fn(() => ({ printer: 'POSPrinter POS-80' })),
  print: vi.fn(() => Promise.resolve()),
  raster: vi.fn(() => Promise.resolve('data:image/png;base64,TICKET')),
}));

vi.mock('qz-tray', () => ({
  websocket: { isActive: qzMocks.isActive, connect: qzMocks.connect },
  printers: { find: qzMocks.find },
  configs: { create: qzMocks.create },
  print: qzMocks.print,
}));

vi.mock('./ticketRaster', () => ({ ticketRasterPngUrl: qzMocks.raster }));

import { printThermalTicket } from './qzPrinter';

const PROFILE = {
  printable_width_mm: 72,
  margin_left_mm: 4,
  margin_right_mm: 4,
  font_family: 'COURIER_NEW' as const,
  font_size_px: 12,
  line_height_px: 20,
  font_weight: 'NORMAL' as const,
  margin_top_mm: 0,
  margin_bottom_mm: 0,
};

describe('QZ thermal printer adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the preview raster to the exact Windows printer as ESC/POS and cuts once', async () => {
    await printThermalTicket('TOTAL 1.25 €', PROFILE);

    expect(qzMocks.find).toHaveBeenCalledWith('POSPrinter POS-80');
    expect(qzMocks.create).toHaveBeenCalledWith(
      'POSPrinter POS-80',
      expect.objectContaining({ jobName: 'OpenERP ticket' }),
    );
    expect(qzMocks.print).toHaveBeenCalledWith({ printer: 'POSPrinter POS-80' }, [
      '\x1b\x40',
      {
        type: 'raw',
        format: 'image',
        data: 'data:image/png;base64,TICKET',
        options: {
          language: 'ESCPOS',
          dotDensity: 'double',
          imageEncoding: 'gs_v_0',
        },
      },
      '\n\n\n',
      '\x1d\x56\x00',
    ]);
  });
});
