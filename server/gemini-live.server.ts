import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { getGoogleCloudAccessToken } from "./antigravity-probe.server";
import type { GeminiApiConfig, GeminiApiSnapshot } from "../shared/gemini-api.shared";

const Page = z.object({
  metrics: z.array(z.object({
    metric: z.string(),
    consumerQuotaLimits: z.array(z.object({
      unit: z.string(),
      quotaBuckets: z.array(z.object({
        effectiveLimit: z.string().regex(/^-?\d+$/).optional(),
        dimensions: z.record(z.string(), z.string()).optional(),
      })).default([]),
    })).default([]),
  })).default([]),
  nextPageToken: z.string().optional(),
});
type QuotaPage = z.infer<typeof Page>;

export function mapGeminiQuotaPages(config: GeminiApiConfig, pages: unknown[], capturedAt: string): GeminiApiSnapshot {
  const models = config.models.map(id => ({ id,
    label: id.replace(/^gemini-/, "Gemini ").replaceAll("-", " ").replace(/\bflash\b/g, "Flash").replace(/\blite\b/g, "Lite").replace(/\btts\b/g, "TTS"),
    rpm: { peak: null, limit: null } as { peak: null; limit: number | null; unlimited?: boolean },
    tpm: { peak: null, limit: null } as { peak: null; limit: number | null; unlimited?: boolean },
    rpd: { peak: null, limit: null } as { peak: null; limit: number | null; unlimited?: boolean },
  }));
  const tier = config.quotaTier === "free" ? "free_tier" : config.quotaTier === "paid" ? "paid_tier" : `paid_tier_${config.quotaTier.slice(-1)}`;
  for (const raw of pages) for (const metric of Page.parse(raw).metrics) {
    const tokenMetric = metric.metric === `generativelanguage.googleapis.com/generate_content_${tier}_input_token_count`;
    const requestMetric = metric.metric === `generativelanguage.googleapis.com/generate_content_${tier}_requests`;
    if (!tokenMetric && !requestMetric) continue;
    for (const quota of metric.consumerQuotaLimits) {
      // Never collapse per-user or regional limits into a project-wide ceiling.
      const key = tokenMetric && quota.unit === "1/min/{project}/{model}" ? "tpm"
        : requestMetric && quota.unit === "1/min/{project}/{model}" ? "rpm"
        : requestMetric && quota.unit === "1/d/{project}/{model}" ? "rpd" : null;
      if (!key) continue;
      for (const bucket of quota.quotaBuckets) {
        const dimensions = bucket.dimensions;
        if (!dimensions || Object.keys(dimensions).length !== 1) continue;
        const model = models.find(item => item.id === dimensions.model);
        if (!model) continue;
        // Protobuf JSON omits int64 zero. Missing model bucket is unknown; an
        // existing bucket without effectiveLimit is an explicitly zero limit.
        const value = Number(bucket.effectiveLimit ?? "0");
        if (!Number.isSafeInteger(value) || value < -1) throw new Error("Некорректное ограничение Google");
        model[key] = { peak: null, limit: value === -1 ? null : value, unlimited: value === -1 };
      }
    }
  }
  return { source: "google-cloud-live", capturedAt, project: config.projectLabel,
    tier: config.quotaTier === "free" ? "free" : "paid", periodDays: 1, models,
    notice: config.usageStatus === "billing-required"
      ? "Расход Monitoring не подключен: на последней проверке Google потребовал биллинг проекта. Ограничения получены автоматически, текущий остаток не известен."
      : "Ограничения получены автоматически. Чтение расхода через Monitoring пока не подключено, текущий остаток не известен.",
  };
}

export interface GeminiLiveAdapters {
  getToken(config: GeminiApiConfig): Promise<string>;
  fetchPage(url: string, token: string, project: string): Promise<unknown>;
  now(): number;
}

export function createGeminiLiveReader(adapters: GeminiLiveAdapters) {
  let cache: { key: string; expires: number; promise: Promise<{ snapshot: GeminiApiSnapshot }> } | undefined;
  return (config: GeminiApiConfig) => {
    const key = JSON.stringify(config);
    if (cache?.key === key && cache.expires > adapters.now()) return cache.promise;
    const promise = (async () => {
      const token = await adapters.getToken(config);
      const pages: QuotaPage[] = [];
      let pageToken = "";
      const seen = new Set<string>();
      do {
        if (seen.has(pageToken) || pages.length >= 20) throw new Error("Google вернул слишком много страниц квот");
        seen.add(pageToken);
        const params = new URLSearchParams({ view: "FULL", pageSize: "200", ...(pageToken ? { pageToken } : {}) });
        const url = `https://serviceusage.googleapis.com/v1beta1/projects/${config.projectNumber}/services/generativelanguage.googleapis.com/consumerQuotaMetrics?${params}`;
        const page = Page.parse(await adapters.fetchPage(url, token, config.projectNumber));
        pages.push(page); pageToken = page.nextPageToken ?? "";
      } while (pageToken);
      return { snapshot: mapGeminiQuotaPages(config, pages, new Date(adapters.now()).toISOString()) };
    })();
    cache = { key, expires: adapters.now() + 60_000, promise };
    return promise;
  };
}

const exec = promisify(execFile);
export const readLiveGemini = createGeminiLiveReader({
  now: Date.now,
  async getToken(config) {
    try {
      if (config.auth === "antigravity") return await getGoogleCloudAccessToken();
      const result = await exec("gcloud", ["auth", "print-access-token"], { timeout: 10_000, maxBuffer: 32768 });
      const token = result.stdout.trim();
      if (!token) throw new Error("empty");
      return token;
    } catch {
      throw new Error(config.auth === "antigravity"
        ? "Нет доступа к Google OAuth Antigravity на этом хосте. Войдите в agy или выберите gcloud в настройке Gemini API."
        : "Нет доступа к Google OAuth gcloud. Установите Google Cloud CLI и выполните gcloud auth login на хосте плагина.");
    }
  },
  async fetchPage(url, token, project) {
    let response: Response;
    try { response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": project }, signal: AbortSignal.timeout(15_000), redirect: "error" }); }
    catch { throw new Error("Не удалось связаться с Google Service Usage API"); }
    let raw: unknown;
    try { raw = await response.json(); } catch { throw new Error("Google Service Usage вернул некорректный JSON"); }
    if (!response.ok) {
      const error = z.object({ error: z.object({ details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional() }).passthrough() }).safeParse(raw);
      const disabled = error.success && error.data.error.details?.some(item => item.reason === "SERVICE_DISABLED");
      throw new Error(disabled
        ? `Service Usage API отключен для проекта ${project}. Включите его через «Как подключить» в карточке Gemini API.`
        : `Google Service Usage вернул HTTP ${response.status}. Проверьте вход Google и права Service Usage Viewer для выбранного проекта.`);
    }
    return raw;
  },
});
