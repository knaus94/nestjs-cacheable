import { DynamicModule, Inject, Module } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { setCacheManager, setGlobalTTL, setLockOptions } from './cacheable.helper';
import { CacheableLockOptions } from './cacheable.interface';
import type { Cache } from 'cache-manager';

export interface CacheableModuleOptions {
  defaultTTL?: number;
  lock?: false | CacheableLockOptions;
}

@Module({})
export class CacheableModule {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    setCacheManager(this.cache);
  }

  static register(opts: CacheableModuleOptions = {}): DynamicModule {
    setGlobalTTL(opts.defaultTTL ?? 0);
    setLockOptions(opts.lock);
    return { module: CacheableModule };
  }
}
