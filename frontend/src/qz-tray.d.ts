declare module 'qz-tray' {
  export const websocket: {
    isActive(): boolean;
    connect(options?: {
      host?: string | string[];
      port?: { secure?: number[]; insecure?: number[] };
      usingSecure?: boolean;
      retries?: number;
      delay?: number;
    }): Promise<void>;
    disconnect(): Promise<void>;
    getConnectionInfo(): { host: string; port: number; socket: string };
  };

  export const printers: {
    find(printerName?: string): Promise<string | string[]>;
  };

  export const configs: {
    create(printerName: string, options?: Record<string, unknown>): unknown;
  };

  export const security: {
    setCertificatePromise(
      handler: () => Promise<string>,
      options?: { rejectOnFailure?: boolean },
    ): void;
    setSignatureAlgorithm(algorithm: 'SHA1' | 'SHA256' | 'SHA512'): void;
    setSignaturePromise(handler: (dataToSign: string) => Promise<string>): void;
  };

  export function print(config: unknown, data: unknown[]): Promise<void>;
}
