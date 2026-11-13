export function instancePort(kind?: 'runtime' | 'launcher'): number;
export function acquireInstanceLock(kind?: 'runtime' | 'launcher', port?: number): Promise<() => void>;
export function defaultDataPath(): string;
export function parsePort(value: string | undefined, allowZero?: boolean): number;
export function checkPort(port: number): Promise<void>;
