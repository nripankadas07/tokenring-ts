import { FakeClock, SystemClock } from '../src/clock';

describe('SystemClock', () => {
  test('now returns a number close to Date.now', () => {
    const clock = new SystemClock();
    const before = Date.now();
    const reading = clock.now();
    const after = Date.now();
    expect(reading).toBeGreaterThanOrEqual(before);
    expect(reading).toBeLessThanOrEqual(after);
  });

  test('setTimer fires the callback after delay', (done) => {
    const clock = new SystemClock();
    const start = clock.now();
    clock.setTimer(() => {
      expect(clock.now() - start).toBeGreaterThanOrEqual(5);
      done();
    }, 10);
  });

  test('setTimer cancellation prevents the callback', (done) => {
    const clock = new SystemClock();
    let fired = false;
    const timer = clock.setTimer(() => {
      fired = true;
    }, 5);
    timer.cancel();
    setTimeout(() => {
      expect(fired).toBe(false);
      done();
    }, 20);
  });
});

describe('FakeClock', () => {
  test('initial time defaults to 0', () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(0);
  });

  test('initial time can be specified', () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
  });

  test('tick advances the clock', () => {
    const clock = new FakeClock();
    clock.tick(500);
    expect(clock.now()).toBe(500);
    clock.tick(250);
    expect(clock.now()).toBe(750);
  });

  test('tick rejects negative values', () => {
    const clock = new FakeClock();
    expect(() => clock.tick(-1)).toThrow();
  });

  test('setTimer fires when the clock reaches fireAt', () => {
    const clock = new FakeClock();
    let fired = false;
    clock.setTimer(() => {
      fired = true;
    }, 100);
    clock.tick(50);
    expect(fired).toBe(false);
    clock.tick(50);
    expect(fired).toBe(true);
  });

  test('multiple timers fire in order', () => {
    const clock = new FakeClock();
    const order: number[] = [];
    clock.setTimer(() => order.push(2), 200);
    clock.setTimer(() => order.push(1), 100);
    clock.setTimer(() => order.push(3), 300);
    clock.tick(500);
    expect(order).toEqual([1, 2, 3]);
  });

  test('cancelled timers do not fire', () => {
    const clock = new FakeClock();
    let fired = false;
    const timer = clock.setTimer(() => {
      fired = true;
    }, 100);
    timer.cancel();
    clock.tick(500);
    expect(fired).toBe(false);
  });

  test('callbacks scheduled inside callbacks fire in the same tick', () => {
    const clock = new FakeClock();
    const order: string[] = [];
    clock.setTimer(() => {
      order.push('outer');
      clock.setTimer(() => order.push('inner'), 50);
    }, 100);
    clock.tick(200);
    expect(order).toEqual(['outer', 'inner']);
  });

  test('clock advances exactly to target after firing all due callbacks', () => {
    const clock = new FakeClock();
    clock.setTimer(() => undefined, 100);
    clock.tick(500);
    expect(clock.now()).toBe(500);
  });

  test('tick(0) fires no callbacks and does not advance', () => {
    const clock = new FakeClock(50);
    let fired = false;
    clock.setTimer(() => {
      fired = true;
    }, 100);
    clock.tick(0);
    expect(clock.now()).toBe(50);
    expect(fired).toBe(false);
  });
});
