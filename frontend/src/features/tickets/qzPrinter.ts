import * as qz from 'qz-tray';

import { DEFAULT_QZ_PRINT_CONFIG, type QzPrintConfig } from '@/features/tickets/qzConfig';
import { getQzSecurity, signQzDigest } from '@/features/tickets/qzSecurityApi';
import { type TicketPrintProfile } from '@/features/tickets/printProfile';
import { ticketRasterPngUrl } from '@/features/tickets/ticketRaster';

export const DEFAULT_THERMAL_PRINTER = DEFAULT_QZ_PRINT_CONFIG.printerName;

export class ThermalPrinterError extends Error {}

let securityConfigured: Promise<boolean> | undefined;
const QZ_OPERATION_TIMEOUT_MS = 12_000;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/** QZ may leave a WebSocket call pending when Windows shows a native prompt
 * or its local service has stopped responding. A user-facing operation must
 * always settle instead of leaving a disabled UI button forever. */
function qzWithin<T>(operation: Promise<T>, action: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(
        new ThermalPrinterError(
          `QZ Tray no ha respondido al ${action} en 12 segundos. ` +
            'Comprueba su ventana, la autorización y la conexión.',
        ),
      );
    }, QZ_OPERATION_TIMEOUT_MS);
    operation.then(
      (result) => {
        window.clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new ThermalPrinterError(errorMessage(error)));
      },
    );
  });
}

async function connectToQz(config: QzPrintConfig): Promise<void> {
  await configureQzSecurity();
  if (qz.websocket.isActive()) {
    const current = qz.websocket.getConnectionInfo();
    if (current.host === config.host && current.port === config.securePort) return;
    await qz.websocket.disconnect();
  }
  try {
    await qzWithin(
      qz.websocket.connect({
        host: config.host,
        port: { secure: [config.securePort], insecure: [] },
        usingSecure: true,
        retries: 2,
        delay: 1,
      }),
      `conectar con ${config.host}:${config.securePort}`,
    );
  } catch (error) {
    throw new ThermalPrinterError(
      `No se puede conectar con QZ Tray en ${config.host}:${config.securePort}. ` +
        `Comprueba QZ, el certificado y el firewall de Windows. (${errorMessage(error)})`,
    );
  }
}

async function configureQzSecurity(): Promise<boolean> {
  securityConfigured ??= (async () => {
    const security = await getQzSecurity();
    if (!security.enabled || security.certificate === null) return false;
    const certificate = security.certificate;
    // QZ 2.2 treats a normal callback as a resolve/reject-style executor and
    // ignores its return value. This must be an actual AsyncFunction so QZ
    // awaits the certificate before completing the WebSocket handshake.
    // eslint-disable-next-line @typescript-eslint/require-await -- QZ detects AsyncFunction at runtime.
    qz.security.setCertificatePromise(async () => certificate, {
      rejectOnFailure: true,
    });
    qz.security.setSignatureAlgorithm('SHA512');
    qz.security.setSignaturePromise(signQzDigest);
    return true;
  })();
  try {
    return await qzWithin(securityConfigured, 'preparar la firma segura');
  } catch (error) {
    securityConfigured = undefined;
    throw new ThermalPrinterError(
      `No se ha podido preparar la firma segura de QZ. (${errorMessage(error)})`,
    );
  }
}

async function findPrinter(config: QzPrintConfig): Promise<string> {
  try {
    const result = await qzWithin(
      qz.printers.find(config.printerName),
      `consultar la impresora «${config.printerName}»`,
    );
    const names = typeof result === 'string' ? [result] : result;
    const exact = names.find((name) => name === config.printerName);
    if (exact === undefined) {
      throw new Error(`No aparece ${config.printerName} entre las impresoras de Windows.`);
    }
    return exact;
  } catch (error) {
    throw new ThermalPrinterError(
      `No se encuentra la impresora «${config.printerName}». (${errorMessage(error)})`,
    );
  }
}

export interface QzConnectionResult {
  printerName: string;
  signingEnabled: boolean;
}

export async function testQzPrinterConnection(config: QzPrintConfig): Promise<QzConnectionResult> {
  const signingEnabled = await configureQzSecurity();
  await connectToQz(config);
  return { printerName: await findPrinter(config), signingEnabled };
}

/** Send the exact preview raster through the Windows RAW spooler as ESC/POS. */
export async function printThermalTicket(
  text: string,
  profile: TicketPrintProfile,
  config: QzPrintConfig = DEFAULT_QZ_PRINT_CONFIG,
): Promise<void> {
  await connectToQz(config);
  const printer = await findPrinter(config);
  const raster = await ticketRasterPngUrl(text, profile);
  const printConfig = qz.configs.create(printer, {
    encoding: 'ISO-8859-1',
    jobName: 'OpenERP ticket',
  });

  try {
    await qzWithin(
      qz.print(printConfig, [
        '\x1b\x40',
        {
          type: 'raw',
          format: 'image',
          data: raster,
          options: {
            language: 'ESCPOS',
            dotDensity: 'double',
            imageEncoding: 'gs_v_0',
          },
        },
        '\x1d\x56\x00',
      ]),
      `enviar el ticket a «${printer}»`,
    );
  } catch (error) {
    throw new ThermalPrinterError(
      `QZ Tray no ha podido imprimir en «${printer}». (${errorMessage(error)})`,
    );
  }
}
