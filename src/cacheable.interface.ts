export type CacheKeyBuilder = (...args: unknown[]) => string;
export type CacheEvictKeyBuilder = (...args: unknown[]) => string | string[];

export interface CacheableDistributedLockClient {
  set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

export interface CacheableLockOptions {
  enabled?: boolean;
  prefix?: string;
  ttl?: number;
  waitTimeout?: number;
  retryDelay?: number;
  retryJitter?: number;
  client?: CacheableDistributedLockClient;
}

export interface CacheableRegisterOptions {
  key?: string | CacheKeyBuilder;
  namespace?: string | CacheKeyBuilder;
  ttl?: number; // ms
}

export interface CacheEvictRegisterOptions {
  key?: string | CacheEvictKeyBuilder;
  namespace?: string | CacheKeyBuilder;
}
