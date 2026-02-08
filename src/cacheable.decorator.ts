import {
  cacheableHandle,
  generateComposedKey,
  getCacheManager,
} from './cacheable.helper';
import {
  CacheableRegisterOptions,
  CacheEvictRegisterOptions,
} from './cacheable.interface';

type AsyncMethod = (...args: unknown[]) => Promise<unknown>;

/* ─── @Cacheable ───────────────────────────────────────────────── */

export function Cacheable(opts: CacheableRegisterOptions): MethodDecorator {
  return (_target, propertyKey, descriptor) => {
    const original = descriptor.value as AsyncMethod;

    (descriptor as PropertyDescriptor).value = (async function (
      ...args: unknown[]
    ) {
      const cm = getCacheManager();
      if (!cm) return original.apply(this, args);

      const key = generateComposedKey({
        methodName: String(propertyKey),
        key: opts.key,
        namespace: opts.namespace,
        args,
      })[0];

      return cacheableHandle(key, () => original.apply(this, args), opts.ttl);
    }) as AsyncMethod;

    return descriptor;
  };
}

/* ─── @CacheEvict ──────────────────────────────────────────────── */

export function CacheEvict(
  ...opts: CacheEvictRegisterOptions[]
): MethodDecorator {
  return (_target, propertyKey, descriptor) => {
    const original = descriptor.value as AsyncMethod;

    (descriptor as PropertyDescriptor).value = (async function (
      ...args: unknown[]
    ) {
      const cm = getCacheManager();
      let result: unknown;
      try {
        result = await original.apply(this, args);
      } finally {
        if (cm) {
          try {
            await Promise.all(
              opts.map((o) => {
                const keys = generateComposedKey({
                  ...o,
                  methodName: String(propertyKey),
                  args,
                });
                return cm.mdel(keys);
              }),
            );
          } catch {
            /* ignore eviction errors */
          }
        }
      }
      return result;
    }) as AsyncMethod;

    return descriptor;
  };
}
