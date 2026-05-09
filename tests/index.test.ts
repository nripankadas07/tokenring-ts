import * as api from '../src/index';

describe('public API surface', () => {
  test('exports TokenBucket and types', () => {
    expect(typeof api.TokenBucket).toBe('function');
  });

  test('exports LeakyBucket and types', () => {
    expect(typeof api.LeakyBucket).toBe('function');
  });

  test('exports clock primitives', () => {
    expect(typeof api.SystemClock).toBe('function');
    expect(typeof api.FakeClock).toBe('function');
  });

  test('exports error classes', () => {
    expect(typeof api.RateLimiterError).toBe('function');
    expect(typeof api.InvalidConfigError).toBe('function');
    expect(typeof api.InvalidTokensError).toBe('function');
  });

  test('TokenBucket usable end-to-end via public API', () => {
    const bucket = new api.TokenBucket({
      capacity: 4,
      refillRate: 1,
      clock: new api.FakeClock(),
    });
    expect(bucket.tryConsume(2)).toBe(true);
    expect(bucket.available).toBe(2);
  });

  test('LeakyBucket usable end-to-end via public API', () => {
    const bucket = new api.LeakyBucket({
      capacity: 4,
      leakRate: 1,
      clock: new api.FakeClock(),
    });
    expect(bucket.tryAdd(2)).toBe(true);
    expect(bucket.level).toBe(2);
  });
});
