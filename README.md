# tokenring-ts

Token-bucket and leaky-bucket rate limiters for TypeScript. Async-aware,
FIFO-fair, with an injectable clock for deterministic tests.

```typescript
import { TokenBucket } from "tokenring-ts";

const bucket = new TokenBucket({
  capacity: 100,
  refillRatePerSecond: 10,
});

if (bucket.tryConsume(1)) {
  // Got a token immediately.
} else {
  await bucket.consume(1); // Waits FIFO until a token is available.
}
```

For tests, pass `now: () => virtualMs` to advance the clock manually.

MIT.
