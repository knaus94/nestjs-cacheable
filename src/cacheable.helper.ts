import { createHash } from 'crypto';
import stringify from 'safe-stable-stringify';
import {
  CacheKeyBuilder,
  CacheEvictKeyBuilder,
  CacheableDistributedLockClient,
  CacheableLockOptions,
} from './cacheable.interface';
import type { Cache } from 'cache-manager';

/* ─────────────── Cache holder ─────────────────────────────────── */

let cacheManager: Cache | undefined;
let globalTTL = 0; // milliseconds

export const getCacheManager = () => cacheManager;
export const setGlobalTTL = (ttl: number) => (globalTTL = ttl);
export const getGlobalTTL = () => globalTTL;

type ResolvedLockOptions = {
  enabled: boolean;
  prefix: string;
  ttl: number;
  waitTimeout: number;
  retryDelay: number;
  retryJitter: number;
  client?: CacheableDistributedLockClient;
};

const DEFAULT_LOCK_OPTIONS: ResolvedLockOptions = {
  enabled: true,
  prefix: 'nestjs-cacheable-lock',
  ttl: 5_000,
  waitTimeout: 2_000,
  retryDelay: 40,
  retryJitter: 20,
  client: undefined,
};

let lockOptions: ResolvedLockOptions = { ...DEFAULT_LOCK_OPTIONS };

const toPositive = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;

export const setLockOptions = (opts?: false | CacheableLockOptions) => {
  if (opts === false) {
    lockOptions = { ...DEFAULT_LOCK_OPTIONS, enabled: false };
    return;
  }

  if (!opts) {
    lockOptions = { ...DEFAULT_LOCK_OPTIONS };
    return;
  }

  lockOptions = {
    enabled: opts.enabled ?? DEFAULT_LOCK_OPTIONS.enabled,
    prefix:
      typeof opts.prefix === 'string' && opts.prefix.trim().length
        ? opts.prefix
        : DEFAULT_LOCK_OPTIONS.prefix,
    ttl: toPositive(opts.ttl, DEFAULT_LOCK_OPTIONS.ttl),
    waitTimeout: toPositive(opts.waitTimeout, DEFAULT_LOCK_OPTIONS.waitTimeout),
    retryDelay: toPositive(opts.retryDelay, DEFAULT_LOCK_OPTIONS.retryDelay),
    retryJitter: toPositive(opts.retryJitter, DEFAULT_LOCK_OPTIONS.retryJitter),
    client: opts.client,
  };
};

/* ─────────────── Key helpers ──────────────────────────────────── */

type KeyType = string | string[] | CacheKeyBuilder | CacheEvictKeyBuilder;

const isKeyBuilder = (
  value: KeyType,
): value is CacheKeyBuilder | CacheEvictKeyBuilder =>
  typeof value === 'function';

const extract = (b: KeyType, a: unknown[]) => {
  const result = isKeyBuilder(b) ? b(...a) : b;
  return Array.isArray(result) ? result : [result];
};

export function generateComposedKey(opts: {
  key?: string | CacheKeyBuilder | CacheEvictKeyBuilder;
  namespace?: string | CacheKeyBuilder;
  methodName: string;
  args: unknown[];
}): string[] {
  const keys = opts.key
    ? extract(opts.key, opts.args)
    : [
        `${opts.methodName}@${createHash('md5')
          .update(stringify(opts.args)) // deterministic & cycle-safe
          .digest('hex')}`,
      ];

  const ns = opts.namespace && extract(opts.namespace, opts.args);
  return keys.map((k) => (ns ? `${ns[0]}:${k}` : k));
}

/* ─────────────── Cache read helpers ───────────────────────────── */

type CacheFetchResult =
  | { hit: true; value: unknown }
  | { hit: false; value: undefined };

const NO_CACHE_RESULT: CacheFetchResult = { hit: false, value: undefined };

interface PendingEntry {
  promise: Promise<unknown>;
  timeout?: NodeJS.Timeout;
}

const pendingMethodCallMap = new Map<string, PendingEntry>();

let pendingTimeout = 30_000; // ms
export const setPendingTimeout = (ms: number) => (pendingTimeout = ms);

const readCached = async (key: string): Promise<CacheFetchResult> => {
  if (!cacheManager) return NO_CACHE_RESULT;
  const value = await cacheManager.get(key);
  return value === undefined ? NO_CACHE_RESULT : { hit: true, value };
};

const readCachedSafely = (key: string) =>
  readCached(key).catch(() => NO_CACHE_RESULT);

const writeCachedSafely = async (
  key: string,
  value: unknown,
  ttl?: number,
) => {
  if (!cacheManager) return;
  await cacheManager.set(key, value, ttl || undefined).catch(() => {});
};

const createPendingEntry = (
  key: string,
  loader: () => Promise<unknown>,
): PendingEntry => {
  const entry: PendingEntry = { promise: Promise.resolve(undefined) };

  if (pendingTimeout > 0) {
    entry.timeout = setTimeout(() => {
      const current = pendingMethodCallMap.get(key);
      if (current === entry) pendingMethodCallMap.delete(key);
    }, pendingTimeout).unref();
  }

  entry.promise = loader().finally(() => {
    if (entry.timeout) clearTimeout(entry.timeout);
    const current = pendingMethodCallMap.get(key);
    if (current === entry) pendingMethodCallMap.delete(key);
  });

  return entry;
};

/* ─────────────── Distributed lock helpers ──────────────────────── */

const LOCK_RELEASE_SCRIPT =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const createLockToken = () =>
  `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

const hasLockClient = (value: unknown): value is CacheableDistributedLockClient =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as { set?: unknown }).set === 'function' &&
  typeof (value as { eval?: unknown }).eval === 'function';

const getStoreRedisClient = (store: unknown): unknown => {
  if (!store || typeof store !== 'object') return undefined;

  const candidate = store as {
    redis?: unknown;
    store?: unknown;
    opts?: { store?: unknown };
  };

  if (candidate.redis !== undefined) return candidate.redis;

  if (candidate.store && typeof candidate.store === 'object') {
    const nested = candidate.store as { redis?: unknown };
    if (nested.redis !== undefined) return nested.redis;
  }

  if (candidate.opts?.store && typeof candidate.opts.store === 'object') {
    const nested = candidate.opts.store as { redis?: unknown };
    if (nested.redis !== undefined) return nested.redis;
  }

  return undefined;
};

const findValkeyLockClient = (
  manager: Cache | undefined,
): CacheableDistributedLockClient | undefined => {
  const stores = manager?.stores;
  if (!stores?.length) return undefined;

  for (const store of stores) {
    const redis = getStoreRedisClient(store);
    if (hasLockClient(redis)) return redis;
  }

  return undefined;
};

export const setCacheManager = (m: Cache) => {
  cacheManager = m;
};

const resolveLockClient = (): CacheableDistributedLockClient | undefined => {
  if (lockOptions.client && hasLockClient(lockOptions.client)) return lockOptions.client;

  return findValkeyLockClient(cacheManager);
};

const tryAcquireLock = async (
  redis: CacheableDistributedLockClient,
  key: string,
  token: string,
  ttl: number,
) => {
  const result = await redis.set(key, token, 'PX', ttl, 'NX').catch(() => undefined);
  return result === 'OK' || result === true;
};

const releaseLock = async (
  redis: CacheableDistributedLockClient,
  key: string,
  token: string,
) => {
  await redis.eval(LOCK_RELEASE_SCRIPT, 1, key, token).catch(() => {});
};

const waitForCacheFill = async (
  key: string,
  opts: ResolvedLockOptions,
): Promise<CacheFetchResult> => {
  const deadline = Date.now() + opts.waitTimeout;
  while (Date.now() < deadline) {
    const jitter = Math.floor(Math.random() * (opts.retryJitter + 1));
    await sleep(opts.retryDelay + jitter);

    const cached = await readCachedSafely(key);
    if (cached.hit) return cached;
  }

  return NO_CACHE_RESULT;
};

type DistributedCallResult = {
  value: unknown;
  fromCache: boolean;
};

const callWithDistributedLock = async (
  key: string,
  method: () => Promise<unknown>,
): Promise<DistributedCallResult> => {
  if (!lockOptions.enabled) {
    return { value: await method(), fromCache: false };
  }

  const redis = resolveLockClient();
  if (!redis) {
    return { value: await method(), fromCache: false };
  }

  const lockKey = `${lockOptions.prefix}:${key}`;
  const token = createLockToken();
  const acquired = await tryAcquireLock(redis, lockKey, token, lockOptions.ttl);

  if (acquired) {
    try {
      const cached = await readCachedSafely(key);
      if (cached.hit) return { value: cached.value, fromCache: true };
      return { value: await method(), fromCache: false };
    } finally {
      await releaseLock(redis, lockKey, token);
    }
  }

  const waited = await waitForCacheFill(key, lockOptions);
  if (waited.hit) return { value: waited.value, fromCache: true };

  return { value: await method(), fromCache: false };
};

/* ─────────────── Main handle ──────────────────────────────────── */

export async function cacheableHandle(
  key: string,
  method: () => Promise<unknown>,
  ttl?: number, // ms
) {
  /* 1. try cache */
  const cached = await readCachedSafely(key);
  if (cached.hit) return cached.value;

  /* 2. deduplicate concurrent calls */
  let entry = pendingMethodCallMap.get(key);
  if (!entry) {
    const ttlMs = ttl ?? globalTTL;
    entry = createPendingEntry(key, async () => {
      const secondCheck = await readCachedSafely(key);
      if (secondCheck.hit) return secondCheck.value;

      const result = await callWithDistributedLock(key, method);
      if (!result.fromCache) {
        await writeCachedSafely(key, result.value, ttlMs);
      }
      return result.value;
    });
    pendingMethodCallMap.set(key, entry);
  }

  return entry.promise;
}
