import { FakeClock } from '../src/clock';
import {
  InvalidConfigError,
  InvalidTokensError,
  RateLimiterError,
} from '../src/errors';
import { LeakyBucket } from '../src/leaky-bucket';

function makeBucket(
  capacity = 10,
  leakRate = 10,
  initialLevel?: number,
): { bucket: LeakyBucket; clock: FakeClock } {
  const clock = new FakeClock();
  const bucket = new LeakyBucket({
    capacity,
    leakRate,
    initialLevel,
    clock,
  });
  return { bucket, clock };
}

describe('LeakyBucket: configuration validation', () => {
  test('rejects non-positive capacity', () => {
    expect(
      () => new LeakyBucket({ capacity: 0, leakRate: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new LeakyBucket({ capacity: -1, leakRate: 1 }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-finite capacity', () => {
    expect(
      () => new LeakyBucket({ capacity: Number.NaN, leakRate: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new LeakyBucket({ capacity: Infinity, leakRate: 1 }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-positive leakRate', () => {
    expect(
      () => new LeakyBucket({ capacity: 10, leakRate: 0 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new LeakyBucket({ capacity: 10, leakRate: -2 }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects non-finite leakRate', () => {
    expect(
      () => new LeakyBucket({ capacity: 10, leakRate: Number.NaN }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new LeakyBucket({ capacity: 10, leakRate: Infinity }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects initialLevel out of range', () => {
    expect(
      () =>
        new LeakyBucket({
          capacity: 10,
          leakRate: 1,
          initialLevel: -1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new LeakyBucket({
          capacity: 10,
          leakRate: 1,
          initialLevel: 11,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new LeakyBucket({
          capacity: 10,
          leakRate: 1,
          initialLevel: Number.NaN,
        }),
    ).toThrow(InvalidConfigError);
  });

  test('rejects null/undefined options', () => {
    expect(
      // @ts-expect-error: deliberate null to verify runtime guard
      () => new LeakyBucket(null),
    ).toThrow(InvalidConfigError);
  });

  test('errors are RateLimiterError subclasses', () => {
    try {
      new LeakyBucket({ capacity: 0, leakRate: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimiterError);
    }
  });
});

describe('LeakyBucket: tryAdd', () => {
  test('starts empty by default', () => {
    const { bucket } = makeBucket();
    expect(bucket.level).toBe(0);
    expect(bucket.available).toBe(10);
  });

  test('respects initialLevel override', () => {
    const { bucket } = makeBucket(10, 1, 7);
    expect(bucket.level).toBe(7);
  });

  test('tryAdd increases level when room available', () => {
    const { bucket } = makeBucket(10, 1);
    expect(bucket.tryAdd(3)).toBe(true);
    expect(bucket.level).toBe(3);
  });

  test('tryAdd defaults to 1 unit', () => {
    const { bucket } = makeBucket(5, 1);
    expect(bucket.tryAdd()).toBe(true);
    expect(bucket.level).toBe(1);
  });

  test('tryAdd returns false on overflow without changing level', () => {
    const { bucket } = makeBucket(5, 1);
    bucket.tryAdd(4);
    expect(bucket.tryAdd(2)).toBe(false);
    expect(bucket.level).toBe(4);
  });

  test('tryAdd to exact capacity succeeds', () => {
    const { bucket } = makeBucket(5, 1);
    expect(bucket.tryAdd(5)).toBe(true);
    expect(bucket.level).toBe(5);
    expect(bucket.tryAdd(0.0001)).toBe(false);
  });

  test('tryAdd(0) is a no-op that returns true', () => {
    const { bucket } = makeBucket(5, 1, 3);
    expect(bucket.tryAdd(0)).toBe(true);
    expect(bucket.level).toBe(3);
  });

  test('rejects negative amounts', () => {
    const { bucket } = makeBucket();
    expect(() => bucket.tryAdd(-1)).toThrow(InvalidTokensError);
  });

  test('rejects non-finite amounts', () => {
    const { bucket } = makeBucket();
    expect(() => bucket.tryAdd(Number.NaN)).toThrow(InvalidTokensError);
    expect(() => bucket.tryAdd(Infinity)).toThrow(InvalidTokensError);
  });

  test('rejects non-number amounts at runtime', () => {
    const { bucket } = makeBucket();
    expect(() =>
      // @ts-expect-error: runtime guard test
      bucket.tryAdd('two'),
    ).toThrow(InvalidTokensError);
  });

  test('rejects amount > capacity', () => {
    const { bucket } = makeBucket(5, 1);
    expect(() => bucket.tryAdd(6)).toThrow(InvalidTokensError);
  });
});

describe('LeakyBucket: leak over time', () => {
  test('level drains at leakRate units per second', () => {
    const { bucket, clock } = makeBucket(10, 10, 10);
    clock.tick(500); // 5 units leak
    expect(bucket.level).toBeCloseTo(5, 6);
  });

  test('leak is floored at zero', () => {
    const { bucket, clock } = makeBucket(10, 10, 5);
    clock.tick(60000); // would leak 600
    expect(bucket.level).toBe(0);
  });

  test('after full drain new admissions succeed', () => {
    const { bucket, clock } = makeBucket(5, 5, 5);
    expect(bucket.tryAdd(1)).toBe(false);
    clock.tick(1000); // drain to 0
    expect(bucket.level).toBe(0);
    expect(bucket.tryAdd(5)).toBe(true);
  });

  test('partial drain frees up partial headroom', () => {
    const { bucket, clock } = makeBucket(10, 10, 10);
    clock.tick(300); // 3 units leak
    expect(bucket.tryAdd(3)).toBe(true);
    expect(bucket.tryAdd(1)).toBe(false);
  });
});

describe('LeakyBucket: state, reset, available', () => {
  test('state returns full snapshot', () => {
    const { bucket } = makeBucket(8, 4, 3);
    const state = bucket.state();
    expect(state.level).toBe(3);
    expect(state.capacity).toBe(8);
    expect(state.leakRate).toBe(4);
  });

  test('available reflects leak progress', () => {
    const { bucket, clock } = makeBucket(10, 10, 10);
    expect(bucket.available).toBe(0);
    clock.tick(500);
    expect(bucket.available).toBeCloseTo(5, 6);
  });

  test('reset returns the bucket to empty', () => {
    const { bucket } = makeBucket(5, 1, 4);
    bucket.reset();
    expect(bucket.level).toBe(0);
  });

  test('reset is idempotent', () => {
    const { bucket } = makeBucket(5, 1);
    bucket.reset();
    bucket.reset();
    expect(bucket.level).toBe(0);
  });
});

describe('LeakyBucket: defaults without injected clock', () => {
  test('construction without clock uses SystemClock', () => {
    const bucket = new LeakyBucket({ capacity: 5, leakRate: 1000000 });
    expect(bucket.level).toBe(0);
    expect(bucket.tryAdd()).toBe(true);
  });
});
