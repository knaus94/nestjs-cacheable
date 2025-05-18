import { DynamicModule, Inject, Module } from '@nestjs/common';
import { setCacheManager, setGlobalTTL } from './cacheable.helper';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';

export interface CacheableModuleOptions {
  defaultTTL?: number;
}

@Module({})
export class CacheableModule {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {
    setCacheManager(this.cache);
  }

  static register(opts: CacheableModuleOptions = {}): DynamicModule {
    if (opts.defaultTTL !== undefined) setGlobalTTL(opts.defaultTTL);
    return { module: CacheableModule };
  }
}
