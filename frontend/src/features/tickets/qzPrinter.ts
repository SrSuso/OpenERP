import * as qz from 'qz-tray';

import { type TicketPrintProfile } from '@/features/tickets/printProfile';
import { ticketRasterPngUrl } from '@/features/tickets/ticketRaster';

export const DEFAULT_THERMAL_PRINTER = 'POSPrinter POS-80';

export class ThermalPrinterError extends Error {}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function connectToQz(): Promise<void> {
  if (qz.websocket.isActive()) return;
  try {
    await qz.websocket.connect({ retries: 2, delay: 1 });
  } catch (error) {
    throw new ThermalPrinterError(
      `No se puede conectar con QZ Tray. Comprueba que está abierto en Windows. (${errorMessage(error)})`,
    );
  }
}

async function findPrinter(): Promise<string> {
  try {
    const result = await qz.printers.find(DEFAULT_THERMAL_PRINTER);
    const names = typeof result === 'string' ? [result] : result;
    const exact = names.find((name) => name === DEFAULT_THERMAL_PRINTER);
    if (exact === undefined) {
      throw new Error(`No aparece ${DEFAULT_THERMAL_PRINTER} entre las impresoras de Windows.`);
    }
    return exact;
  } catch (error) {
    throw new ThermalPrinterError(
      `No se encuentra la impresora «${DEFAULT_THERMAL_PRINTER}». (${errorMessage(error)})`,
    );
  }
}

/** Send the exact preview raster through the Windows RAW spooler as ESC/POS. */
export async function printThermalTicket(text: string, profile: TicketPrintProfile): Promise<void> {
  await connectToQz();
  const printer = await findPrinter();
  const raster = await ticketRasterPngUrl(text, profile);
  const config = qz.configs.create(printer, {
    encoding: 'ISO-8859-1',
    jobName: 'OpenERP ticket',
  });

  try {
    await qz.print(config, [
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
      '\n\n\n',
      '\x1d\x56\x00',
    ]);
  } catch (error) {
    throw new ThermalPrinterError(
      `QZ Tray no ha podido imprimir en «${printer}». (${errorMessage(error)})`,
    );
  }
}
