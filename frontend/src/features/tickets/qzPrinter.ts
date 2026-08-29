import * as qz from 'qz-tray';

import { DEFAULT_QZ_PRINT_CONFIG, type QzPrintConfig } from '@/features/tickets/qzConfig';
import { getQzSecurity, signQzDigest } from '@/features/tickets/qzSecurityApi';
import { type TicketPrintProfile } from '@/features/tickets/printProfile';
import {
  THERMAL_PRINTER_DPI,
  ticketRasterContentPngUrl,
  ticketRasterGeometry,
} from '@/features/tickets/ticketRaster';

export const DEFAULT_THERMAL_PRINTER = DEFAULT_QZ_PRINT_CONFIG.printerName;

export class ThermalPrinterError extends Error {}

let securityConfigured: Promise<boolean> | undefined;
const QZ_OPERATION_TIMEOUT_MS = 12_000;
const MILLIMETRES_PER_INCH = 25.4;
const ESC_POS_MAX_FEED_DOTS = 255;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/**
 * ESC J feeds an exact number of vertical motion units.  With the POS-80's
 * 203 dpi mechanism one unit is one dot, so this is more reliable than blank
 * text lines: it is physical paper movement and cannot be collapsed by an
 * image conversion or confused with the font line height.
 */
function verticalMarginFeed(millimetres: number): string | null {
  const dots = Math.min(
    ESC_POS_MAX_FEED_DOTS,
    Math.max(0, Math.round((millimetres * THERMAL_PRINTER_DPI) / MILLIMETRES_PER_INCH)),
  );
  return dots === 0 ? null : `\x1b\x4a${String.fromCharCode(dots)}`;
}

function escPosUnsigned16(prefix: string, value: number): string {
  const safeValue = Math.min(0xffff, Math.max(0, Math.round(value)));
  return `${prefix}${String.fromCharCode(safeValue & 0xff, safeValue >> 8)}`;
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
  // Vertical margins are moved by the printer, rather than represented as
  // blank image rows.  Some ESC/POS paths optimise blank raster rows away;
  // ESC J cannot disappear and keeps the margin correct before the cutter.
  const printProfile = {
    ...profile,
    margin_top_mm: 0,
    margin_bottom_mm: 0,
  };
  const raster = await ticketRasterContentPngUrl(text, printProfile);
  const geometry = ticketRasterGeometry(printProfile, 1);
  const topMargin = verticalMarginFeed(profile.margin_top_mm);
  const bottomMargin = verticalMarginFeed(profile.margin_bottom_mm);
  const printConfig = qz.configs.create(printer, {
    encoding: 'ISO-8859-1',
    jobName: 'OpenERP ticket',
  });

  try {
    await qzWithin(
      qz.print(printConfig, [
        '\x1b\x40',
        // Define the physical print area in dots. GS v 0 then starts the
        // cropped image at this left margin instead of at paper coordinate 0.
        '\x1d\x50\xcb\xcb',
        escPosUnsigned16('\x1d\x4c', geometry.contentLeftDots),
        escPosUnsigned16('\x1d\x57', geometry.contentWidthDots),
        ...(topMargin === null ? [] : [topMargin]),
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
        ...(bottomMargin === null ? [] : [bottomMargin]),
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
