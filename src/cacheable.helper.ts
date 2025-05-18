import { createHash } from 'crypto';
import stringify from 'safe-stable-stringify';
import { CacheKeyBuilder, CacheEvictKeyBuilder } from './cacheable.interface';
import type { Cache } from '@nestjs/cache-manager';

/* ─────────────── Cache-manager holder ─────────────────────────── */

let cacheManager!: Cache; // any store (memory, redis, …)
let globalTTL = 0; // milliseconds

export const setCacheManager = (m: Cache) => (cacheManager = m);
export const getCacheManager = () => cacheManager;
export const setGlobalTTL = (ttl: number) => (globalTTL = ttl);
export const getGlobalTTL = () => globalTTL;

/* ─────────────── Key helpers ──────────────────────────────────── */

type KeyType = string | string[] | CacheKeyBuilder | CacheEvictKeyBuilder;

const extract = (b: KeyType, a: unknown[]) => {
  const result = typeof b === 'function' ? (b as any)(...a) : b;
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

const pendingCacheMap = new Map<string, Promise<unknown>>();

async function fetchCachedValue(key: string) {
  let p = pendingCacheMap.get(key);
  if (!p) {
    p = cacheManager.get(key); // any | null
    pendingCacheMap.set(key, p);
  }

  let val: unknown | null;
  try {
    val = await p;
  } finally {
    pendingCacheMap.delete(key);
  }
  return val ?? undefined;
}

/* ─────────────── Pending-call map + sweeper ───────────────────── */

interface PendingEntry {
  promise: Promise<unknown>;
  ts: number; // ms
}
const pendingMethodCallMap = new Map<string, PendingEntry>();

let pendingTimeout = 30_000; // ms
let sweepInterval = 5_000; // ms
export const setPendingTimeout = (ms: number) => (pendingTimeout = ms);
export const setSweepInterval = (ms: number) => (sweepInterval = ms);

let sweeper: NodeJS.Timeout | null = null;

function runSweep() {
  const now = Date.now();
  for (const [k, e] of pendingMethodCallMap) {
    if (now - e.ts > pendingTimeout) pendingMethodCallMap.delete(k);
  }
  if (pendingMethodCallMap.size === 0) stopSweeper();
}
function startSweeper() {
  if (!sweeper) sweeper = setInterval(runSweep, sweepInterval).unref();
}
function stopSweeper() {
  if (sweeper) {
    clearInterval(sweeper);
    sweeper = null;
  }
}

/* ─────────────── Main handle ──────────────────────────────────── */

export async function cacheableHandle(
  key: string,
  method: () => Promise<unknown>,
  ttl?: number, // ms
) {
  /* 1. try cache */
  try {
    const hit = await fetchCachedValue(key);
    if (hit !== undefined) return hit;
  } catch {
    /* swallow cache read errors */
  }

  /* 2. deduplicate concurrent calls */
  let entry = pendingMethodCallMap.get(key);
  if (!entry) {
    entry = { promise: method(), ts: Date.now() };
    pendingMethodCallMap.set(key, entry);
    startSweeper();
  }

  let value: unknown;
  try {
    value = await entry.promise;
  } finally {
    pendingMethodCallMap.delete(key);
    if (pendingMethodCallMap.size === 0) stopSweeper();
  }

  /* 3. write back */
  const ttlMs = ttl ?? globalTTL;
  await cacheManager.set(key, value, ttlMs ?? undefined);
  return value;
}
