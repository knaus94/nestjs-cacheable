# nestjs-cacheable

> Service-level caching for NestJS.

`@knaus94/nestjs-cacheable` extends the standard `CacheModule` so you can cache **service method** calls—not only controller responses—using two simple decorators:

| Decorator       | Purpose                                                         |
|-----------------|-----------------------------------------------------------------|
| `@Cacheable`    | Stores the method’s return value under a generated key & TTL.   |
| `@CacheEvict`   | Removes one or many keys after the method finishes successfully.|

---

## Installation

```bash
npm i @knaus94/nestjs-cacheable          # or
yarn add @knaus94/nestjs-cacheable
```

## Quick Start

```typescript
// app.module.ts
import { Module, CacheModule } from '@nestjs/common';
import { CacheableModule } from '@knaus94/nestjs-cacheable';

@Module({
  imports: [
    CacheModule.register({ isGlobal: true }), // any cache-manager store
    CacheableModule.register(),               // default JSON serializer
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
| **`CacheableModule.register(cfg)`** | Enables service-level caching.<br>`cfg.defaultTTL` (ms) sets a fallback TTL.   |

## License

[MIT licensed](LICENSE).