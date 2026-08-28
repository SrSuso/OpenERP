declare module 'qz-tray' {
  export const websocket: {
    isActive(): boolean;
    connect(options?: { retries?: number; delay?: number }): Promise<void>;
  };

  export const printers: {
    find(printerName?: string): Promise<string | string[]>;
  };

  export const configs: {
    create(printerName: string, options?: Record<string, unknown>): unknown;
  };

  export function print(config: unknown, data: unknown[]): Promise<void>;
}
