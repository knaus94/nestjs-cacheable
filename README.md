# nestjs-cacheable

> Service-level caching for NestJS.

`@dessly/nestjs-cacheable` provides service-level method caching powered by `Keyv`/`@keyv/valkey`.

| Decorator       | Purpose                                                         |
|-----------------|-----------------------------------------------------------------|
| `@Cacheable`    | Stores the method’s return value under a generated key & TTL.   |
| `@CacheEvict`   | Removes one or many keys after the method finishes successfully.|

---

## Installation

```bash
npm i @dessly/nestjs-cacheable          # or
yarn add @dessly/nestjs-cacheable
```

## Quick Start

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import KeyvValkey from '@keyv/valkey';
import { CacheableModule } from '@knaus94/nestjs-cacheable';

const cache = new KeyvValkey('redis://localhost:6379');

@Module({
  imports: [
    CacheModule.register({
      stores: [cache],
      isGlobal: true,
    }),
    CacheableModule.register({ defaultTTL: 5000 }),
  ],
})
export class AppModule {}
```

```typescript
// user.service.ts
@Injectable()
export class UserService {
  /** Result is cached for 5 seconds */
  @Cacheable({
    key: (id: number) => `username-${id}`,
    namespace: 'user',
    ttl: 5000,              // milliseconds
  })
  async getUserName(id: number) {
    return this.db.query(/* … */);
  }

  /** Cache entry is removed after deletion */
  @CacheEvict({
    key: (id: number) => `username-${id}`,
    namespace: 'user',
  })
  async deleteUser(id: number) {
    await this.db.delete(/* … */);
  }
}
```

| Item                                | Description                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| **`Cacheable(options)`**            | Caches the method result. <br>Options: `key`, `namespace`, `ttl`.              |
| **`CacheEvict(options)`**           | Deletes keys after the method succeeds.                                        |
| **`CacheableModule.register(cfg)`** | Enables service-level caching.<br>`cfg.defaultTTL` sets fallback TTL (ms).     |

## Concurrency behavior

- In-process deduplication for same key (`single-flight`).
- Optional distributed lock across instances (`SET NX PX`) when Redis/Valkey client is available.
- `fail-open` on cache write errors (business method result is still returned).
- `null` values are cached (negative caching).

```typescript
CacheableModule.register({
  defaultTTL: 5000,
  lock: {
    enabled: true,
    prefix: 'nestjs-cacheable-lock',
    ttl: 5000,
    waitTimeout: 2000,
    retryDelay: 40,
    retryJitter: 20,
  },
});
```

## License

[MIT licensed](LICENSE).
