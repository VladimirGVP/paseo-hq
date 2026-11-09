const ROW_OVERHEAD = 256;

export interface CacheEntry {
  readonly body: Buffer;
  readonly meta: string;
  readonly expired: boolean;
}

interface StoredRow {
  body: Buffer;
  meta: string;
  bytes: number;
  expiresAt: number;
  usedAt: number;
}

export class WebCache {
  private readonly rows = new Map<string, StoredRow>();
  private totalBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): CacheEntry | null {
    const row = this.rows.get(key);
    if (row === undefined) return null;
    const now = this.now();
    row.usedAt = now;
    this.rows.delete(key);
    this.rows.set(key, row);
    return { body: row.body, meta: row.meta, expired: row.expiresAt <= now };
  }

  put(key: string, body: Buffer, meta: string, ttlMs: number): void {
    const existing = this.rows.get(key);
    if (existing !== undefined) {
      this.totalBytes -= existing.bytes;
      this.rows.delete(key);
    }
    const now = this.now();
    const bytes = body.length + meta.length + ROW_OVERHEAD;
    this.rows.set(key, {
      body,
      meta,
      bytes,
      expiresAt: now + ttlMs,
      usedAt: now,
    });
    this.totalBytes += bytes;
    this.evict();
  }

  renew(key: string, meta: string, ttlMs: number): void {
    const existing = this.rows.get(key);
    if (existing === undefined) return;
    const now = this.now();
    this.totalBytes -= existing.bytes;
    const bytes = existing.body.length + meta.length + ROW_OVERHEAD;
    this.rows.delete(key);
    this.rows.set(key, {
      body: existing.body,
      meta,
      bytes,
      expiresAt: now + ttlMs,
      usedAt: now,
    });
    this.totalBytes += bytes;
  }

  size(): number {
    return this.totalBytes;
  }

  private evict(): void {
    if (this.totalBytes <= this.maxBytes) return;
    const target = this.maxBytes * 0.8;
    for (const [key, row] of this.rows.entries()) {
      if (this.totalBytes <= target) break;
      this.rows.delete(key);
      this.totalBytes -= row.bytes;
    }
  }
}
