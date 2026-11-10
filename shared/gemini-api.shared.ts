import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const PeakLimitSchema = z.object({
  peak: z.number().finite().nonnegative().nullable(),
  limit: z.number().finite().nonnegative().nullable(),
  unlimited: z.boolean().optional(),
}).strict();

/** AI Studio's selected-period peaks are not a current quota balance. */
export const GeminiApiSnapshotSchema = z.object({
  source: z.enum(["ai-studio-snapshot", "google-cloud-live"]),
  notice: z.string().optional(),
  capturedAt: z.string().datetime({ offset: true }),
  project: z.string().min(1).max(160),
  tier: z.enum(["free", "paid", "unknown"]),
  periodDays: z.number().int().min(1).max(366),
  models: z.array(z.object({
    id: z.string().min(1).max(160),
    label: z.string().min(1).max(160),
    rpm: PeakLimitSchema,
    tpm: PeakLimitSchema,
    rpd: PeakLimitSchema,
  }).strict()).max(100),
}).strict();

export const GEMINI_API_QUERY_KEY = ["usage-limits", "gemini-api"] as const;
export const GeminiApiConfigSchema = z.object({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/),
  projectNumber: z.string().regex(/^\d{6,20}$/),
  projectLabel: z.string().min(1).max(160),
  auth: z.enum(["antigravity", "gcloud"]).default("antigravity"),
  quotaTier: z.enum(["free", "paid", "paid-2", "paid-3"]).default("free"),
  usageStatus: z.enum(["not-connected", "billing-required"]).default("not-connected"),
  models: z.array(z.string().regex(/^[a-zA-Z0-9._-]+$/)).min(1).max(100),
}).strict();
export type GeminiApiConfig = z.infer<typeof GeminiApiConfigSchema>;
export const GEMINI_API_LINKS = [
  { label: "Живые лимиты", url: "https://aistudio.google.com/rate-limit" },
  { label: "Расход API", url: "https://aistudio.google.com/usage" },
  { label: "Биллинг", url: "https://aistudio.google.com/billing" },
  { label: "Кредиты Pro", url: "https://me.developers.google.com/benefits" },
] as const;

export const readGeminiApiLimits = defineRpc({
  name: "usage.gemini-api.read",
  input: z.object({}),
  output: z.object({ snapshot: GeminiApiSnapshotSchema.nullable() }),
});
export const readGeminiApiHelp = defineRpc({
  name: "usage.gemini-api.help", input: z.object({}),
  output: z.object({ markdown: z.string(), config: GeminiApiConfigSchema.nullable() }),
});
export const writeGeminiApiConfig = defineRpc({
  name: "usage.gemini-api.configure", input: GeminiApiConfigSchema,
  output: z.object({ saved: z.literal(true) }),
});

export type GeminiApiSnapshot = z.infer<typeof GeminiApiSnapshotSchema>;
