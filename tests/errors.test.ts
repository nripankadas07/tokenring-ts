import {
  RateLimiterError,
  InvalidConfigError,
  InvalidTokensError,
} from '../src/errors';

describe('error hierarchy', () => {
  test('RateLimiterError is an Error', () => {
    const error = new RateLimiterError('boom');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimiterError);
    expect(error.name).toBe('RateLimiterError');
    expect(error.message).toBe('boom');
  });

  test('InvalidConfigError extends RateLimiterError', () => {
    const error = new InvalidConfigError('bad config');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimiterError);
    expect(error).toBeInstanceOf(InvalidConfigError);
    expect(error.name).toBe('InvalidConfigError');
  });

  test('InvalidTokensError extends RateLimiterError', () => {
    const error = new InvalidTokensError('bad tokens');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(RateLimiterError);
    expect(error).toBeInstanceOf(InvalidTokensError);
    expect(error.name).toBe('InvalidTokensError');
  });

  test('errors are catchable as RateLimiterError', () => {
    const errors = [
      new RateLimiterError('a'),
      new InvalidConfigError('b'),
      new InvalidTokensError('c'),
    ];
    for (const error of errors) {
      let caught: unknown = null;
      try {
        throw error;
      } catch (caughtError) {
        caught = caughtError;
      }
      expect(caught).toBeInstanceOf(RateLimiterError);
    }
  });

  test('error stack traces include the constructor message', () => {
    const error = new InvalidConfigError('detail message');
    expect(error.stack).toContain('detail message');
  });
});
