# tokenring-ts

Token-bucket and leaky-bucket rate limiters for TypeScript. Async-aware, FIFO-fair, with an injectable clock for deterministic tests.

```ts
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

## Non-goals

- **Not distributed.** State lives in one process. For multi-host limiting, use Redis.
- **Not a load-shedder.** It blocks; it does not return 429 for you. Wrap your handler if you need rejection.
- **Not a scheduler.** No cron, no priorities, no per-key limiters out of the box (compose your own with `Map<key, TokenBucket>` — it's three lines).

## Install

```bash
npm install tokenring-ts
```

Zero runtime dependencies. Ships ESM + CJS + `.d.ts`.

## Why both buckets

| | TokenBucket | LeakyBucket |
|---|---|---|
| **Burst behaviour** | Allows bursts up to `capacity`. | Smooths to a steady rate. |
| **Refill model** | Tokens added at `refillRatePerSecond`. | Drains at `leakRatePerSecond`. |
| **Best for** | API client backoff, "10 req/s but allow 100 in a burst". | Egress shaping, "exactly N/s, no spikes". |

## API

```ts
new TokenBucket({ capacity, refillRatePerSecond, now? })
new LeakyBucket({ capacity, leakRatePerSecond, now? })

bucket.tryConsume(n = 1): boolean        // non-blocking; returns false if not enough.
bucket.consume(n = 1): Promise<void>     // blocks FIFO until n tokens available.
bucket.available(): number               // current token count (after refill).
```

`now?: () => number` is the injectable clock. Default uses `Date.now()`. In tests, pass `() => virtualMs` and advance the clock manually:

```ts
let t = 0;
const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 1, now: () => t });
bucket.tryConsume(5);                    // true
bucket.tryConsume(1);                    // false — empty
t = 1000;
bucket.tryConsume(1);                    // true — 1s of refill = 1 token
```

This is what makes the test suite deterministic. No `setTimeout`, no flaky CI.

## FIFO fairness

`consume()` resolves in the order calls were made. If three callers each request 10 tokens from a 30-capacity bucket and tokens dribble in at 1/s, the first caller fully drains for 10s, then the second, then the third. No livelock, no starvation.

## Running tests

```bash
npm install
npm test
```

`tsc --strict` and `jest` pass on Node 18+. Coverage report includes a virtual-clock harness for the FIFO behaviour, which would be untestable with real time.

## License

MIT.
