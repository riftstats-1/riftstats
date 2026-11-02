// One limiter per fetcher/client, shared by every endpoint and retry.
// Rolling windows are deliberately conservative across all Riot routing hosts.
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, Math.min(ms, 2_147_483_647));
    const abort = () => { clearTimeout(timer); reject(signal?.reason); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function rateFromEnv(name: string, maximum: number): number {
  const value = process.env[name] === undefined ? maximum : Number(process.env[name]);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} måste vara ett heltal mellan 1 och ${maximum}`);
  }
  return value;
}

export class RiotLimiter {
  #timestamps: number[] = [];
  #lastRequest = -Infinity;
  #blockedUntil = 0;

  constructor(private readonly perSecond: number, private readonly perTwoMinutes: number) {}

  defer(ms: number) { this.#blockedUntil = Math.max(this.#blockedUntil, Date.now() + ms); }

  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      const now = Date.now();
      this.#timestamps = this.#timestamps.filter((time) => time > now - 120_000);
      const windowEnd = this.#timestamps.length >= this.perTwoMinutes
        ? this.#timestamps[this.#timestamps.length - this.perTwoMinutes] + 120_000 : 0;
      const next = Math.max(this.#blockedUntil, windowEnd, this.#lastRequest + Math.ceil(1000 / this.perSecond));
      if (next > now) {
        await wait(next - now, signal);
        continue;
      }
      this.#timestamps.push(now);
      this.#lastRequest = now;
      return;
    }
  }
}
