import { beforeEach, describe, expect, it, vi } from 'vitest';

const qzMocks = vi.hoisted(() => ({
  isActive: vi.fn(() => false),
  connect: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(() => Promise.resolve()),
  getConnectionInfo: vi.fn(() => ({ host: '192.168.1.50', port: 8181, socket: '' })),
  find: vi.fn(() => Promise.resolve('Caja charcutería')),
  create: vi.fn(() => ({ printer: 'Caja charcutería' })),
  print: vi.fn(() => Promise.resolve()),
  raster: vi.fn(() => Promise.resolve('data:image/png;base64,TICKET')),
  geometry: vi.fn(() => ({ contentLeftDots: 0, contentWidthDots: 576 })),
  certificate: vi.fn(),
  algorithm: vi.fn(),
  signature: vi.fn(),
  getSecurity: vi.fn(() =>
    Promise.resolve({ enabled: true, certificate: '-----BEGIN CERTIFICATE-----\nPUBLIC\n' }),
  ),
  sign: vi.fn(() => Promise.resolve('SIGNED')),
}));

vi.mock('qz-tray', () => ({
  websocket: {
    isActive: qzMocks.isActive,
    connect: qzMocks.connect,
    disconnect: qzMocks.disconnect,
    getConnectionInfo: qzMocks.getConnectionInfo,
  },
  printers: { find: qzMocks.find },
  configs: { create: qzMocks.create },
  security: {
    setCertificatePromise: qzMocks.certificate,
    setSignatureAlgorithm: qzMocks.algorithm,
    setSignaturePromise: qzMocks.signature,
  },
  print: qzMocks.print,
}));

vi.mock('./ticketRaster', () => ({
  THERMAL_PRINTER_DPI: 203,
  ticketRasterContentPngUrl: qzMocks.raster,
  ticketRasterGeometry: qzMocks.geometry,
}));
vi.mock('./qzSecurityApi', () => ({
  getQzSecurity: qzMocks.getSecurity,
  signQzDigest: qzMocks.sign,
}));

import { printThermalTicket, testQzPrinterConnection } from './qzPrinter';

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
  beforeEach(() => {
    vi.clearAllMocks();
    qzMocks.isActive.mockReturnValue(false);
    qzMocks.geometry.mockReturnValue({ contentLeftDots: 0, contentWidthDots: 576 });
  });

  it('sends the preview raster to the exact Windows printer as ESC/POS and cuts once', async () => {
    await printThermalTicket('TOTAL 1.25 €', PROFILE, {
      host: '192.168.1.50',
      securePort: 8282,
      printerName: 'Caja charcutería',
    });

    expect(qzMocks.certificate).toHaveBeenCalledOnce();
    const certificateProvider = qzMocks.certificate.mock.calls[0]?.[0] as
      (() => Promise<string>) | undefined;
    if (certificateProvider === undefined) throw new Error('QZ certificate provider was not set.');
    expect(certificateProvider.constructor.name).toBe('AsyncFunction');
    await expect(certificateProvider()).resolves.toBe('-----BEGIN CERTIFICATE-----\nPUBLIC\n');
    expect(qzMocks.algorithm).toHaveBeenCalledWith('SHA512');
    expect(qzMocks.signature).toHaveBeenCalledWith(qzMocks.sign);
    expect(qzMocks.connect).toHaveBeenCalledWith({
      host: '192.168.1.50',
      port: { secure: [8282], insecure: [] },
      usingSecure: true,
      retries: 2,
      delay: 1,
    });
    expect(qzMocks.find).toHaveBeenCalledWith('Caja charcutería');
    expect(qzMocks.create).toHaveBeenCalledWith(
      'Caja charcutería',
      expect.objectContaining({ jobName: 'OpenERP ticket' }),
    );
    expect(qzMocks.print).toHaveBeenCalledWith({ printer: 'Caja charcutería' }, [
      '\x1b\x40',
      '\x1d\x50\xcb\xcb',
      '\x1d\x4c\x00\x00',
      '\x1d\x57\x40\x02',
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
      '\x1d\x56\x00',
    ]);
  });

  it('feeds the configured top and bottom margins as physical ESC/POS paper movement', async () => {
    await printThermalTicket(
      'TOTAL 1.25 €',
      { ...PROFILE, margin_top_mm: 5, margin_bottom_mm: 7 },
      {
        host: '192.168.1.50',
        securePort: 8282,
        printerName: 'Caja charcutería',
      },
    );

    expect(qzMocks.raster).toHaveBeenCalledWith(
      'TOTAL 1.25 €',
      expect.objectContaining({ margin_top_mm: 0, margin_bottom_mm: 0 }),
    );
    expect(qzMocks.print).toHaveBeenCalledWith(expect.anything(), [
      '\x1b\x40',
      '\x1d\x50\xcb\xcb',
      '\x1d\x4c\x00\x00',
      '\x1d\x57\x40\x02',
      '\x1b\x4a\x28',
      expect.objectContaining({ type: 'raw', format: 'image' }),
      '\x1b\x4a\x38',
      '\x1d\x56\x00',
    ]);
  });

  it('sets a narrower cropped raster inside explicit left and right print margins', async () => {
    qzMocks.raster.mockClear();
    qzMocks.geometry.mockReturnValueOnce({
      contentLeftDots: 16,
      contentWidthDots: 512,
    });

    await printThermalTicket(
      'TOTAL 1.25 €',
      { ...PROFILE, printable_width_mm: 64, margin_left_mm: 6, margin_right_mm: 10 },
      {
        host: '192.168.1.50',
        securePort: 8282,
        printerName: 'Caja charcutería',
      },
    );

    expect(qzMocks.print).toHaveBeenCalledWith(expect.anything(), [
      '\x1b\x40',
      '\x1d\x50\xcb\xcb',
      '\x1d\x4c\x10\x00',
      '\x1d\x57\x00\x02',
      expect.objectContaining({ type: 'raw', format: 'image' }),
      '\x1d\x56\x00',
    ]);
  });

  it('disconnects a previous QZ destination before using the saved remote host', async () => {
    qzMocks.isActive.mockReturnValue(true);
    qzMocks.getConnectionInfo.mockReturnValue({
      host: 'localhost',
      port: 8181,
      socket: 'wss',
    });

    await testQzPrinterConnection({
      host: '192.168.1.50',
      securePort: 8181,
      printerName: 'Caja charcutería',
    });

    expect(qzMocks.disconnect).toHaveBeenCalledOnce();
    expect(qzMocks.connect).toHaveBeenCalledWith(expect.objectContaining({ host: '192.168.1.50' }));
  });

  it('turns an unresponsive QZ printer query into a useful error instead of hanging', async () => {
    vi.useFakeTimers();
    qzMocks.find.mockImplementationOnce(() => new Promise(() => undefined));

    try {
      const result = testQzPrinterConnection({
        host: '192.168.1.50',
        securePort: 8181,
        printerName: 'Caja charcutería',
      });
      const rejected = expect(result).rejects.toThrow('QZ Tray no ha respondido');
      await vi.advanceTimersByTimeAsync(12_000);

      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
