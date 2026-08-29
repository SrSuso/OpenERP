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

vi.mock('./ticketRaster', () => ({ ticketRasterPngUrl: qzMocks.raster }));
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
