interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class ResponseCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlSeconds: number, maxEntries = 1000) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    if (!this.enabled) return;
    this.store.set(key, { data, expiresAt: Date.now() + this.ttlMs });
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) this.store.delete(key);
    }
  }
}
