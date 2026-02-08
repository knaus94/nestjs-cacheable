import { DynamicModule, Module } from '@nestjs/common';
import { setCacheManager, setGlobalTTL, setLockOptions } from './cacheable.helper';
import { CacheableLockOptions } from './cacheable.interface';
import type KeyvValkey from '@keyv/valkey';

export interface CacheableModuleOptions {
  cache: KeyvValkey;
  defaultTTL?: number;
  lock?: false | CacheableLockOptions;
}

@Module({})
export class CacheableModule {
  static register(opts: CacheableModuleOptions): DynamicModule {
    setCacheManager(opts.cache);
    if (opts.defaultTTL !== undefined) setGlobalTTL(opts.defaultTTL);
    if (opts.lock !== undefined) setLockOptions(opts.lock);
    return { module: CacheableModule };
  }
}
