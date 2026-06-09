import { logger } from './logger';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
}

export class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private state: CircuitState = 'closed';
  private nextAttemptAt = 0;
  private readonly opts: CircuitBreakerOptions;
  private readonly name: string;

  constructor(name: string, opts: Partial<CircuitBreakerOptions> = {}) {
    this.name = name;
    this.opts = {
      failureThreshold: opts.failureThreshold ?? 5,
      successThreshold: opts.successThreshold ?? 2,
      timeoutMs: opts.timeoutMs ?? 60_000,
    };
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttemptAt) {
        throw new Error(`Circuit breaker open for: ${this.name}`);
      }
      this.state = 'half-open';
      logger.warn('Circuit breaker attempting recovery', { service: this.name });
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= this.opts.successThreshold) {
        this.state = 'closed';
        this.successes = 0;
        logger.info('Circuit breaker closed — service recovered', { service: this.name });
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.successes = 0;
    if (this.failures >= this.opts.failureThreshold) {
      this.state = 'open';
      this.nextAttemptAt = Date.now() + this.opts.timeoutMs;
      logger.error('Circuit breaker opened', {
        service: this.name,
        failures: this.failures,
        retry_at: new Date(this.nextAttemptAt).toISOString(),
      });
    }
  }

  getState(): CircuitState { return this.state; }
}

export const redisBreaker  = new CircuitBreaker('redis',  { failureThreshold: 3, timeoutMs: 30_000 });
