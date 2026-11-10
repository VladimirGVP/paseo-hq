import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const PeakLimitSchema = z.object({
  peak: z.number().finite().nonnegative().nullable(),
  limit: z.number().finite().nonnegative().nullable(),
}).strict();

/** AI Studio's selected-period peaks are not a current quota balance. */
export const GeminiApiSnapshotSchema = z.object({
  source: z.literal("ai-studio-snapshot"),
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

export type GeminiApiSnapshot = z.infer<typeof GeminiApiSnapshotSchema>;
