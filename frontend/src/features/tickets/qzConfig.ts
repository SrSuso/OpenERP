import { useQuery } from '@tanstack/react-query';

import { settingsValuesQuery } from '@/features/settings/optionsApi';

export interface QzPrintConfig {
  host: string;
  securePort: number;
  printerName: string;
}

export const DEFAULT_QZ_PRINT_CONFIG: QzPrintConfig = {
  host: 'localhost',
  securePort: 8181,
  printerName: 'POSPrinter POS-80',
};

export function qzPrintConfigFromValues(values?: Record<string, string>): QzPrintConfig {
  const configuredPort = Number(values?.['pos.qz_secure_port']);
  const securePort = [8181, 8282, 8383, 8484].includes(configuredPort)
    ? configuredPort
    : DEFAULT_QZ_PRINT_CONFIG.securePort;
  return {
    host: values?.['pos.qz_host']?.trim() || DEFAULT_QZ_PRINT_CONFIG.host,
    securePort,
    printerName: values?.['pos.qz_printer_name']?.trim() || DEFAULT_QZ_PRINT_CONFIG.printerName,
  };
}

/** Wait for saved settings before doing an irreversible print. */
export function useSettledQzPrintConfig(): QzPrintConfig | undefined {
  const settings = useQuery(settingsValuesQuery);
  if (settings.isPending) return undefined;
  return qzPrintConfigFromValues(settings.data);
}
