import { FakeClock } from '../src/clock';
import {
  InvalidConfigError,
  InvalidTokensError,
  RateLimiterError,
} from '../src/errors';
import { TokenBucket } from '../src/token-bucket';

function makeBucket(
  capacity = 10,
  refillRate = 10,
  initialTokens?: number,
): { bucket: TokenBucket; clock: FakeClock } {
  const clock = new FakeClock();
  const bucket = new TokenBucket({
    capacity,
    refillRate,
    initialTokens,
    clock,
  });
  return { bucket, clock };
}

describe('TokenBucket: configuration validation', () => {
  test('rejects non-positive capacity', () => {
    expect(
      () => new TokenBucket({ capacity: 0, refillRate: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new TokenBucket({ capacity: -1, refillRate: 1 }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-finite capacity', () => {
    expect(
      () => new TokenBucket({ capacity: Number.NaN, refillRate: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new TokenBucket({ capacity: Infinity, refillRate: 1 }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-positive refillRate', () => {
    expect(
      () => new TokenBucket({ capacity: 10, refillRate: 0 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new TokenBucket({ capacity: 10, refillRate: -2 }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-finite refillRate', () => {
    expect(
      () => new TokenBucket({ capacity: 10, refillRate: Number.NaN }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new TokenBucket({ capacity: 10, refillRate: Infinity }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects initialTokens out of range', () => {
    expect(
      () =>
        new TokenBucket({
          capacity: 10,
          refillRate: 1,
          initialTokens: -1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new TokenBucket({
          capacity: 10,
          refillRate: 1,
          initialTokens: 11,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new TokenBucket({
          capacity: 10,
          refillRate: 1,
          initialTokens: Number.NaN,
        }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects null/undefined options', () => {
    expect(
      // @ts-expect-error: deliberate null to verify runtime guard
      () => new TokenBucket(null),
    ).toThrow(InvalidConfigError);
  });

  test('errors are RateLimiterError subclasses', () => {
    try {
      new TokenBucket({ capacity: 0, refillRate: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimiterError);
    }
  });
});

describe('TokenBucket: tryConsume', () => {
  test('starts full by default', () => {
    const { bucket } = makeBucket(5, 1);
    expect(bucket.available).toBe(5);
  });

  test('respects initialTokens override', () => {
    const { bucket } = makeBucket(5, 1, 0);
    expect(bucket.available).toBe(0);
  });

  test('tryConsume succeeds when tokens available', () => {
    const { bucket } = makeBucket(5, 1);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.available).toBe(4);
  });

  test('tryConsume defaults to 1 token', () => {
    const { bucket } = makeBucket(3, 1);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.available).toBe(2);
  });

  test('tryConsume returns false when not enough tokens', () => {
    const { bucket } = makeBucket(2, 1, 0);
    expect(bucket.tryConsume(1)).toBe(false);
    expect(bucket.available).toBe(0);
  });

  test('tryConsume(0) is a no-op that returns true', () => {
    const { bucket } = makeBucket(5, 1);
    expect(bucket.tryConsume(0)).toBe(true);
    expect(bucket.available).toBe(5);
  });

  test('rejects negative tokens', () => {
    const { bucket } = makeBucket();
    expect(() => bucket.tryConsume(-1)).toThrow(InvalidTokensError);
  });

  test('rejects non-finite tokens', () => {
    const { bucket } = makeBucket();
    expect(() => bucket.tryConsume(Number.NaN)).toThrow(InvalidTokensError);
    expect(() => bucket.tryConsume(Infinity)).toThrow(InvalidTokensError);
  });

  test('rejects non-number tokens at runtime', () => {
    const { bucket } = makeBucket();
    expect(() =>
      // @ts-expect-error: runtime guard test
      bucket.tryConsume('one'),
    ).toThrow(InvalidTokensError);
  });

  test('rejects amount > capacity (would never succeed)', () => {
    const { bucket } = makeBucket(5, 1);
    expect(() => bucket.tryConsume(6)).toThrow(InvalidTokensError);
  });

  test('refills over time at refillRate', () => {
    const { bucket, clock } = makeBucket(10, 10, 0);
    expect(bucket.tryConsume(1)).toBe(false);
    clock.tick(500); // 5 tokens added
    expect(bucket.available).toBeCloseTo(5, 6);
    expect(bucket.tryConsume(5)).toBe(true);
    expect(bucket.available).toBeCloseTo(0, 6);
  });

  test('refill is capped at capacity', () => {
    const { bucket, clock } = makeBucket(10, 10);
    clock.tick(60000); // would add 600 tokens
    expect(bucket.available).toBe(10);
  });

  test('long sleep then consume does not over-accrue', () => {
    const { bucket, clock } = makeBucket(5, 1, 0);
    clock.tick(1000 * 60 * 60); // 1 hour
    expect(bucket.available).toBe(5);
    expect(bucket.tryConsume(5)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
  });
});

describe('TokenBucket: consume (async)', () => {
  test('resolves immediately when tokens available', async () => {
    const { bucket } = makeBucket(5, 1);
    await expect(bucket.consume(1)).resolves.toBeUndefined();
    expect(bucket.available).toBe(4);
  });

  test('consume(0) resolves immediately', async () => {
    const { bucket } = makeBucket(5, 1, 0);
    await expect(bucket.consume(0)).resolves.toBeUndefined();
  });

  test('queues when not enough tokens, resolves after refill', async () => {
    const { bucket, clock } = makeBucket(5, 5, 0);
    let resolved = false;
    const promise = bucket.consume(2).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    clock.tick(400); // 2 tokens
    await Promise.resolve();
    await promise;
    expect(resolved).toBe(true);
  });

  test('FIFO ordering for queued waiters', async () => {
    const { bucket, clock } = makeBucket(10, 10, 0);
    const order: number[] = [];
    const promise1 = bucket.consume(3).then(() => order.push(1));
    const promise2 = bucket.consume(2).then(() => order.push(2));
    const promise3 = bucket.consume(1).then(() => order.push(3));
    clock.tick(600); // 6 tokens, all should release
    await Promise.all([promise1, promise2, promise3]);
    expect(order).toEqual([1, 2, 3]);
  });

  test('FIFO blocks even if a later waiter could be served', async () => {
    const { bucket, clock } = makeBucket(5, 5, 0);
    const order: number[] = [];
    const promise1 = bucket.consume(5).then(() => order.push(1));
    const promise2 = bucket.consume(1).then(() => order.push(2));
    clock.tick(200); // 1 token, but waiter 1 needs 5
    await Promise.resolve();
    expect(order).toEqual([]);
    clock.tick(800); // total 5 tokens — waiter 1 served, waiter 2 still waits
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1]);
    clock.tick(200); // 1 more token
    await Promise.all([promise1, promise2]);
    expect(order).toEqual([1, 2]);
  });

  test('rejects with InvalidTokensError for bad amount', async () => {
    const { bucket } = makeBucket();
    await expect(bucket.consume(-1)).rejects.toThrow(InvalidTokensError);
    await expect(bucket.consume(Number.NaN)).rejects.toThrow(
      InvalidTokensError,
    );
    await expect(bucket.consume(999)).rejects.toThrow(InvalidTokensError);
  });

  test('reset replenishes tokens and serves pending waiters', async () => {
    const { bucket } = makeBucket(5, 1, 0);
    let resolved = false;
    const promise = bucket.consume(3).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    bucket.reset();
    await Promise.resolve();
    await promise;
    expect(resolved).toBe(true);
    expect(bucket.available).toBeCloseTo(2, 6);
  });
});

describe('TokenBucket: state and reset', () => {
  test('state returns full snapshot', () => {
    const { bucket } = makeBucket(8, 4, 3);
    const state = bucket.state();
    expect(state.tokens).toBe(3);
    expect(state.capacity).toBe(8);
    expect(state.refillRate).toBe(4);
    expect(state.pending).toBe(0);
  });

  test('state.pending reflects queued consumers', () => {
    const { bucket } = makeBucket(5, 1, 0);
    void bucket.consume(2);
    void bucket.consume(3);
    expect(bucket.state().pending).toBe(2);
  });

  test('reset returns the bucket to capacity', () => {
    const { bucket } = makeBucket(5, 1);
    bucket.tryConsume(3);
    expect(bucket.available).toBe(2);
    bucket.reset();
    expect(bucket.available).toBe(5);
  });

  test('reset is idempotent', () => {
    const { bucket } = makeBucket(5, 1);
    bucket.reset();
    bucket.reset();
    expect(bucket.available).toBe(5);
  });
});

describe('TokenBucket: defaults without injected clock', () => {
  test('construction without clock uses SystemClock', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRate: 1000000 });
    expect(bucket.available).toBeGreaterThan(0);
    expect(bucket.tryConsume()).toBe(true);
  });

  test('consume() defaults to 1 token', async () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket({
      capacity: 3,
      refillRate: 1,
      clock,
    });
    await expect(bucket.consume()).resolves.toBeUndefined();
    expect(bucket.available).toBe(2);
  });
});
