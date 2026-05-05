/**
 * tokenring-ts — token-bucket + leaky-bucket rate limiters.
 *
 * Both buckets share a tiny common shape:
 *
 *   `tryConsume(n)` returns true if `n` tokens were available now.
 *   `consume(n)`    returns a Promise that resolves once `n` tokens are
 *                   available; pending requests form a strict FIFO queue.
 *
 * The clock is injectable — pass `now: () => 1000` to drive the bucket
 * deterministically in tests.
 */

export type Clock = () => number;

export interface TokenBucketOptions {
  /** Maximum number of tokens the bucket can hold. */
  capacity: number;
  /** How many tokens are replenished per second. */
  refillRatePerSecond: number;
  /** Optional clock; defaults to performance.now-equivalent (Date.now()). */
  now?: Clock;
}

interface PendingRequest {
  needed: number;
  resolve: () => void;
  reject: (reason?: unknown) => void;
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export class TokenBucket {
  readonly capacity: number;
  readonly refillRatePerSecond: number;
  private tokens: number;
  private lastRefillMs: number;
  private readonly now: Clock;
  private readonly queue: PendingRequest[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) {
      throw new RateLimitError(`capacity must be > 0, got ${opts.capacity}`);
    }
    if (opts.refillRatePerSecond <= 0) {
      throw new RateLimitError(
        `refillRatePerSecond must be > 0, got ${opts.refillRatePerSecond}`,
      );
    }
    this.capacity = opts.capacity;
    this.refillRatePerSecond = opts.refillRatePerSecond;
    this.tokens = opts.capacity;
    this.now = opts.now ?? (() => Date.now());
    this.lastRefillMs = this.now();
  }

  /** Refill tokens based on elapsed time. */
  private refill(): void {
    const t = this.now();
    const elapsedSec = (t - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsedSec * this.refillRatePerSecond,
    );
    this.lastRefillMs = t;
  }

  /** Current number of available tokens (refills first). */
  get available(): number {
    this.refill();
    return this.tokens;
  }

  /** Try to consume `n` tokens immediately. Returns true on success. */
  tryConsume(n = 1): boolean {
    if (n <= 0) {
      throw new RateLimitError(`n must be > 0, got ${n}`);
    }
    if (n > this.capacity) {
      throw new RateLimitError(
        `n=${n} exceeds capacity=${this.capacity}`,
      );
    }
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Wait until `n` tokens are available, then consume them. FIFO. */
  consume(n = 1): Promise<void> {
    if (n <= 0) {
      return Promise.reject(new RateLimitError(`n must be > 0, got ${n}`));
    }
    if (n > this.capacity) {
      return Promise.reject(
        new RateLimitError(`n=${n} exceeds capacity=${this.capacity}`),
      );
    }
    if (this.queue.length === 0 && this.tryConsume(n)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ needed: n, resolve, reject });
      this.scheduleDrain();
    });
  }

  private scheduleDrain(): void {
    if (this.timer || this.queue.length === 0) return;
    this.refill();
    const head = this.queue[0]!;
    if (this.tokens >= head.needed) {
      this.drain();
      return;
    }
    const deficit = head.needed - this.tokens;
    const waitMs = (deficit / this.refillRatePerSecond) * 1000;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, Math.max(1, Math.ceil(waitMs)));
  }

  private drain(): void {
    this.refill();
    while (this.queue.length > 0) {
      const head = this.queue[0]!;
      if (this.tokens < head.needed) break;
      this.tokens -= head.needed;
      this.queue.shift();
      head.resolve();
    }
    this.scheduleDrain();
  }

  /** Reject all pending requests and stop the timer. */
  destroy(reason: unknown = new RateLimitError("bucket destroyed")): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0) {
      this.queue.shift()!.reject(reason);
    }
  }
}

export interface LeakyBucketOptions {
  /** Maximum queue depth (requests, not tokens). */
  capacity: number;
  /** How many requests drain per second. */
  leakRatePerSecond: number;
  now?: Clock;
}

/**
 * Leaky-bucket: requests join a queue that drains at a fixed rate.
 * Differs from TokenBucket in that bursts cannot exceed steady rate —
 * the queue drains at exactly `leakRatePerSecond`.
 */
export class LeakyBucket {
  readonly capacity: number;
  readonly leakRatePerSecond: number;
  private queue: PendingRequest[] = [];
  private lastLeakMs: number;
  private readonly now: Clock;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: LeakyBucketOptions) {
    if (opts.capacity <= 0) {
      throw new RateLimitError(`capacity must be > 0, got ${opts.capacity}`);
    }
    if (opts.leakRatePerSecond <= 0) {
      throw new RateLimitError(
        `leakRatePerSecond must be > 0, got ${opts.leakRatePerSecond}`,
      );
    }
    this.capacity = opts.capacity;
    this.leakRatePerSecond = opts.leakRatePerSecond;
    this.now = opts.now ?? (() => Date.now());
    this.lastLeakMs = this.now();
  }

  get pending(): number {
    return this.queue.length;
  }

  consume(): Promise<void> {
    if (this.queue.length >= this.capacity) {
      return Promise.reject(
        new RateLimitError(`queue full (capacity=${this.capacity})`),
      );
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ needed: 1, resolve, reject });
      this.scheduleLeak();
    });
  }

  private scheduleLeak(): void {
    if (this.timer || this.queue.length === 0) return;
    const intervalMs = 1000 / this.leakRatePerSecond;
    const elapsed = this.now() - this.lastLeakMs;
    const wait = Math.max(1, Math.ceil(intervalMs - elapsed));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.lastLeakMs = this.now();
      const head = this.queue.shift();
      if (head) head.resolve();
      this.scheduleLeak();
    }, wait);
  }

  destroy(reason: unknown = new RateLimitError("bucket destroyed")): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0) {
      this.queue.shift()!.reject(reason);
    }
  }
}
