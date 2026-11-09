import { defineRpc, type RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";

const sampleSchema = z.object({
  at: z.number(),
  cpuPercent: z.number(),
  memoryPercent: z.number(),
  rxBytesPerSec: z.number(),
  txBytesPerSec: z.number(),
});

const diskSchema = z.object({
  mount: z.string(),
  device: z.string(),
  fsType: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  /** Free space an unprivileged user can still write; excludes blocks reserved for root. */
  availableBytes: z.number(),
});

const memorySchema = z.object({
  totalBytes: z.number(),
  /** Memory in use and not reclaimable: what the RAM percentage shows. */
  usedBytes: z.number(),
  /** macOS: cached files the system can drop at once, counted as neither used nor free. */
  cachedBytes: z.number().nullable(),
  /** macOS: the kernel's memory pressure level; when present it, not the percentage, sets the color. */
  pressure: z.enum(["normal", "warning", "critical"]).nullable(),
});

const memoryProcessSchema = z.object({
  pid: z.number(),
  label: z.string(),
  scope: z.string().nullable(),
  count: z.number(),
  bytes: z.number(),
  rssBytes: z.number(),
});

const memoryTopSchema = z.object({
  byGroup: z.array(memoryProcessSchema),
  byPid: z.array(memoryProcessSchema),
});

export const publicIpSchema = z.object({
  address: z.string(),
  iface: z.string(),
  family: z.string().default("IPv4"),
});

export const hostStatsRpc = defineRpc({
  name: "host.stats",
  input: z.object({}),
  output: z.object({
    hostname: z.string(),
    platform: z.string(),
    uptimeSeconds: z.number(),
    cpuCount: z.number(),
    cpuModel: z.string(),
    loadAverage: z.tuple([z.number(), z.number(), z.number()]),
    memory: memorySchema,
    memoryTop: memoryTopSchema,
    network: z
      .object({ rxTotalBytes: z.number(), txTotalBytes: z.number() })
      .nullable(),
    traffic24h: z.object({rx:z.number(),tx:z.number(),hours:z.number(),complete:z.boolean(),iface:z.string()}).nullable(),
    publicIps: z.array(publicIpSchema).default([]),
    disks: z.array(diskSchema),
    sampleIntervalMs: z.number(),
    current: sampleSchema,
    history: z.array(sampleSchema),
  }),
});

export type HostSample = z.infer<typeof sampleSchema>;
export type DiskUsage = z.infer<typeof diskSchema>;
export type MemoryUsage = z.infer<typeof memorySchema>;
export type MemoryPressure = NonNullable<MemoryUsage["pressure"]>;
export type MemoryProcess = z.infer<typeof memoryProcessSchema>;
export type MemoryTop = z.infer<typeof memoryTopSchema>;
export type PublicIp = z.infer<typeof publicIpSchema>;
export type HostStats = RpcOutput<typeof hostStatsRpc>;
