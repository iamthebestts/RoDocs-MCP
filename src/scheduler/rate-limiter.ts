export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private backoffUntil: number = 0;
  private retryCount: number = 0;

  constructor(tokensPerSecond: number) {
    this.maxTokens = tokensPerSecond;
    this.tokens = tokensPerSecond;
    this.refillRate = tokensPerSecond / 1000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const delta = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + delta * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      if (now < this.backoffUntil) {
        await new Promise((resolve) => setTimeout(resolve, this.backoffUntil - now));
        continue;
      }

      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }

      const waitTime = Math.ceil(1 / this.refillRate);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  reportError(status: number) {
    if ([429, 502, 503, 504].includes(status)) {
      this.retryCount++;
      const backoffMs = 2 ** this.retryCount * 1000 + Math.random() * 1000;
      this.backoffUntil = Date.now() + backoffMs;
    } else {
      this.retryCount = 0;
    }
  }

  resetBackoff() {
    this.retryCount = 0;
    this.backoffUntil = 0;
  }
}
