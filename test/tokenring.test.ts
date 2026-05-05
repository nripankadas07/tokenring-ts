import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenBucket, LeakyBucket, RateLimitError } from "../src/index.js";

// Manual virtual clock so timing tests are deterministic.
function makeClock() {
  let now = 0;
  return {
    advance(ms: number) { now += ms; },
    set(ms: number) { now = ms; },
    fn: () => now,
  };
}

test("TokenBucket: starts full", () => {
  const c = makeClock();
  const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 5, now: c.fn });
  assert.equal(b.available, 10);
});

test("TokenBucket: tryConsume succeeds within capacity", () => {
  const c = makeClock();
  const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 5, now: c.fn });
  assert.equal(b.tryConsume(3), true);
  assert.equal(b.available, 7);
});

test("TokenBucket: tryConsume fails when empty", () => {
  const c = makeClock();
  const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 1, now: c.fn });
  assert.equal(b.tryConsume(5), true);
  assert.equal(b.tryConsume(1), false);
});

test("TokenBucket: refills over time", () => {
  const c = makeClock();
  const b = new TokenBucket({ capacity: 10, refillRatePerSecond: 5, now: c.fn });
  b.tryConsume(10);
  assert.equal(b.available, 0);
  c.advance(1000); // 1s → 5 tokens
  assert.equal(b.available, 5);
  c.advance(10000); // saturate
  assert.equal(b.available, 10);
});

test("TokenBucket: rejects oversized request", () => {
  const c = makeClock();
  const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 1, now: c.fn });
  assert.throws(() => b.tryConsume(10), RateLimitError);
});

test("TokenBucket: rejects non-positive n", () => {
  const c = makeClock();
  const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 1, now: c.fn });
  assert.throws(() => b.tryConsume(0), RateLimitError);
});

test("TokenBucket: invalid construction", () => {
  assert.throws(() => new TokenBucket({ capacity: 0, refillRatePerSecond: 1 }), RateLimitError);
  assert.throws(() => new TokenBucket({ capacity: 5, refillRatePerSecond: 0 }), RateLimitError);
});

test("TokenBucket: consume() resolves immediately when capacity is available", async () => {
  const c = makeClock();
  const b = new TokenBucket({ capacity: 5, refillRatePerSecond: 1, now: c.fn });
  await b.consume(3);
  assert.equal(b.available, 2);
});

test("LeakyBucket: rejects when full", () => {
  const c = makeClock();
  const b = new LeakyBucket({ capacity: 1, leakRatePerSecond: 100, now: c.fn });
  // Queue one without awaiting it
  b.consume().catch(() => {});
  // Second should reject (capacity 1 already taken)
  return b.consume().then(
    () => assert.fail("expected reject"),
    (err) => assert.ok(err instanceof RateLimitError),
  );
});

test("LeakyBucket: invalid construction", () => {
  assert.throws(() => new LeakyBucket({ capacity: 0, leakRatePerSecond: 1 }), RateLimitError);
  assert.throws(() => new LeakyBucket({ capacity: 5, leakRatePerSecond: 0 }), RateLimitError);
});
