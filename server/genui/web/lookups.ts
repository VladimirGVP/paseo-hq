import { setTimeout as sleep } from "node:timers/promises";
import { WebCache, type CacheEntry } from "./cache";
import { foundImageSchema, pickImage, searchUrl, type FoundImage } from "./commons";
import { geocodeUrl, locatedSchema, pickLocation, type Located } from "./geocode";
import { declaresImage, sniffImage } from "./image";
import { safeGet, type Fetched, type GetOptions } from "./net";

export const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
const CACHE_BYTES = 64 * 1024 * 1024;
const DAY_MS = 86_400_000;
const TILE_TTL_MS = 7 * DAY_MS;
const IMAGE_TTL_MS = 7 * DAY_MS;
const FOUND_TTL_MS = 30 * DAY_MS;
const MISS_TTL_MS = DAY_MS;
const GEOCODE_SPACING_MS = 1_100;
export const MAX_TILE_ZOOM = 19;

export type WebFailure = { readonly ok: false; readonly error: string; readonly off?: boolean };
export type WebImage = { readonly ok: true; readonly dataUrl: string } | WebFailure;
export type WebSearch = { readonly ok: true; readonly image: FoundImage } | WebFailure;
export type WebPlace = ({ readonly ok: true } & Located) | WebFailure;

const OFF: WebFailure = {
  ok: false,
  off: true,
  error: "Web lookups are off in the Generative UI plugin settings",
};

function limiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function dataUrl(mime: string, body: Buffer): string {
  return `data:${mime};base64,${body.toString("base64")}`;
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }
}

function metaOf(entry: CacheEntry): Record<string, unknown> {
  const meta = parseJson(Buffer.from(entry.meta, "utf8"));
  return typeof meta === "object" && meta !== null && !Array.isArray(meta)
    ? Object.fromEntries(Object.entries(meta))
    : {};
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface WebLookups {
  image(url: string): Promise<WebImage>;
  search(query: string): Promise<WebSearch>;
  geocode(name: string, near: Located | null): Promise<WebPlace>;
  tile(z: number, x: number, y: number): Promise<WebImage>;
  isOn(): boolean;
}

export function createWebLookups(isEnabled: () => Promise<boolean>, isOnSync: () => boolean): WebLookups {
  const cache = new WebCache(CACHE_BYTES);
  const inFlight = new Map<string, Promise<unknown>>();

  function once<T>(key: string, task: () => Promise<T>): Promise<T> {
    const running = inFlight.get(key);
    if (running !== undefined) return running as Promise<T>;
    const started = task().finally(() => inFlight.delete(key));
    inFlight.set(key, started);
    return started;
  }

  function cached(key: string): CacheEntry | null {
    try {
      return cache.get(key);
    } catch {
      return null;
    }
  }

  function store(write: () => void): void {
    try {
      write();
    } catch {
      // Ignore cache write errors
    }
  }

  const images = limiter(4);
  const tiles = limiter(2);
  const api = limiter(2);
  let nextGeocodeAt = 0;

  const imageRequest: GetOptions = {
    accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8",
    maxBytes: MAX_REMOTE_IMAGE_BYTES,
    timeoutMs: 20_000,
  };
  const jsonRequest: GetOptions = {
    accept: "application/json",
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 15_000,
  };

  async function image(input: string): Promise<WebImage> {
    if (!(await isEnabled())) return OFF;
    let url: string;
    try {
      url = new URL(input).href;
    } catch {
      return { ok: false, error: "not a valid URL" };
    }
    const key = `img:${url}`;
    return once(key, async (): Promise<WebImage> => {
      const hit = cached(key);
      const hitMime = hit === null ? null : metaOf(hit).mime;
      if (hit !== null && !hit.expired && typeof hitMime === "string") {
        return { ok: true, dataUrl: dataUrl(hitMime, hit.body) };
      }
      const fetched = await images(() => safeGet(url, imageRequest));
      if (!fetched.ok) {
        return hit !== null && typeof hitMime === "string"
          ? { ok: true, dataUrl: dataUrl(hitMime, hit.body) }
          : fetched;
      }
      const mime = sniffImage(fetched.body);
      if (mime === null || !declaresImage(fetched.headers["content-type"])) {
        return { ok: false, error: "the link is not a png, jpeg, gif, webp, avif or svg image" };
      }
      store(() => cache.put(key, fetched.body, JSON.stringify({ mime }), IMAGE_TTL_MS));
      return { ok: true, dataUrl: dataUrl(mime, fetched.body) };
    });
  }

  async function search(query: string): Promise<WebSearch> {
    if (!(await isEnabled())) return OFF;
    const normalized = normalize(query);
    if (normalized === "") return { ok: false, error: "the search is empty" };
    const key = `search:${normalized}`;
    const notFound: WebFailure = { ok: false, error: `no photo found for “${query.trim()}”` };
    return once(key, async (): Promise<WebSearch> => {
      const hit = cached(key);
      const parsed = hit === null ? null : foundImageSchema.nullable().safeParse(metaOf(hit).image);
      const remembered = parsed?.success ? parsed.data : null;
      if (hit !== null && !hit.expired && parsed?.success) {
        return remembered === null ? notFound : { ok: true, image: remembered };
      }
      const fetched: Fetched = await api(() => safeGet(searchUrl(normalized), jsonRequest));
      if (!fetched.ok) return remembered !== null ? { ok: true, image: remembered } : fetched;
      const found: FoundImage | null = pickImage(parseJson(fetched.body));
      store(() =>
        cache.put(
          key,
          Buffer.alloc(0),
          JSON.stringify({ image: found }),
          found === null ? MISS_TTL_MS : FOUND_TTL_MS,
        ),
      );
      return found === null ? notFound : { ok: true, image: found };
    });
  }

  async function geocode(name: string, near: Located | null): Promise<WebPlace> {
    if (!(await isEnabled())) return OFF;
    const normalized = normalize(name);
    if (normalized === "") return { ok: false, error: "the place has no name" };
    const bias = near === null ? "" : `${near.lat.toFixed(1)},${near.lng.toFixed(1)}`;
    const key = `geo:${normalized}|${bias}`;
    const notFound: WebFailure = { ok: false, error: `couldn't find “${name.trim()}” on the map` };
    return once(key, async (): Promise<WebPlace> => {
      const hit = cached(key);
      const parsed = hit === null ? null : locatedSchema.nullable().safeParse(metaOf(hit).place);
      const remembered = parsed?.success ? parsed.data : null;
      if (hit !== null && !hit.expired && parsed?.success) {
        return remembered === null ? notFound : { ok: true, ...remembered };
      }
      const now = Date.now();
      const slot = Math.max(now, nextGeocodeAt);
      nextGeocodeAt = slot + GEOCODE_SPACING_MS;
      if (slot > now) await sleep(slot - now);
      const fetched = await safeGet(geocodeUrl(normalized, near), jsonRequest);
      if (!fetched.ok) return remembered !== null ? { ok: true, ...remembered } : fetched;
      const found = pickLocation(parseJson(fetched.body));
      store(() =>
        cache.put(
          key,
          Buffer.alloc(0),
          JSON.stringify({ place: found }),
          found === null ? MISS_TTL_MS : FOUND_TTL_MS,
        ),
      );
      return found === null ? notFound : { ok: true, ...found };
    });
  }

  async function tile(z: number, x: number, y: number): Promise<WebImage> {
    if (!(await isEnabled())) return OFF;
    const span = 2 ** z;
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > MAX_TILE_ZOOM || x < 0 || y < 0 || x >= span || y >= span) {
      return { ok: false, error: "no such tile" };
    }
    const key = `tile:${z}/${x}/${y}`;
    return once(key, async (): Promise<WebImage> => {
      const hit = cached(key);
      const meta = hit === null ? {} : metaOf(hit);
      if (hit !== null && !hit.expired) return { ok: true, dataUrl: dataUrl("image/png", hit.body) };
      const validators: Record<string, string> = {};
      if (hit !== null && typeof meta.etag === "string") validators["if-none-match"] = meta.etag;
      if (hit !== null && typeof meta.lastModified === "string") validators["if-modified-since"] = meta.lastModified;
      const fetched = await tiles(() =>
        safeGet(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
          accept: "image/png",
          maxBytes: 1024 * 1024,
          timeoutMs: 15_000,
          headers: validators,
        }),
      );
      if (!fetched.ok) return hit !== null ? { ok: true, dataUrl: dataUrl("image/png", hit.body) } : fetched;
      if (fetched.status === 304 && hit !== null) {
        store(() => cache.renew(key, hit.meta, TILE_TTL_MS));
        return { ok: true, dataUrl: dataUrl("image/png", hit.body) };
      }
      if (sniffImage(fetched.body) !== "image/png") {
        return { ok: false, error: "the tile server sent something other than a png" };
      }
      const etag = fetched.headers.etag;
      const lastModified = fetched.headers["last-modified"];
      store(() => cache.put(key, fetched.body, JSON.stringify({ etag, lastModified }), TILE_TTL_MS));
      return { ok: true, dataUrl: dataUrl("image/png", fetched.body) };
    });
  }

  return { image, search, geocode, tile, isOn: isOnSync };
}
