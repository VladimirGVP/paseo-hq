import type { PluginTheme, RpcOutput } from "@getpaseo/plugin";
import type { PluginPopoverProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import {
  hostStatsRpc,
  type DiskUsage,
  type HostSample,
  type MemoryPressure,
  type MemoryUsage,
  type PublicIp,
} from "../shared/contracts";
import { formatBytes, formatCompactRate, formatPercent, formatRate, formatUptime } from "./format";

const ICON_SIZE = 14;
const FONT_SIZE = 12;
const ICON_GAP = 6;
const METER_HEIGHT = 6;

export type HostStats = RpcOutput<typeof hostStatsRpc>;
export type Severity = MemoryPressure;

export function useHostStats(enabled = true) {
  const getStats = useRpc(hostStatsRpc);
  const [data, setData] = useState<HostStats | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const res = await getStats({});
        if (!cancelled) setData(res);
      } catch {
        // Keep previous snapshot on transient failure.
      }
    };
    void fetchStats();
    const timer = setInterval(() => void fetchStats(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, getStats]);

  return { data };
}

export function percentSeverity(percent: number): Severity {
  if (percent >= 90) return "critical";
  if (percent >= 70) return "warning";
  return "normal";
}

export function severityColor(theme: PluginTheme, severity: Severity): string {
  if (severity === "critical") return theme.colors.statusDanger;
  if (severity === "warning") return theme.colors.statusWarning;
  return theme.colors.foregroundMuted;
}

export function loadColor(theme: PluginTheme, percent: number): string {
  return severityColor(theme, percentSeverity(percent));
}

export function memoryPercent(memory: Pick<MemoryUsage, "usedBytes" | "totalBytes">): number {
  return memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0;
}

export function memorySeverity(memory: MemoryUsage): Severity {
  return memory.pressure ?? percentSeverity(memoryPercent(memory));
}

export function diskPercent(disk: Pick<DiskUsage, "usedBytes" | "availableBytes">): number {
  const usable = disk.usedBytes + disk.availableBytes;
  return usable > 0 ? (disk.usedBytes / usable) * 100 : 0;
}

export function sumDisks(disks: readonly DiskUsage[]) {
  const sum = { totalBytes: 0, usedBytes: 0, availableBytes: 0 };
  for (const disk of disks) {
    sum.totalBytes += disk.totalBytes;
    sum.usedBytes += disk.usedBytes;
    sum.availableBytes += disk.availableBytes;
  }
  return { ...sum, percent: diskPercent(sum) };
}

export function scaleToPeak(samples: readonly HostSample[], pick: (s: HostSample) => number) {
  const peak = Math.max(1, ...samples.map(pick));
  return samples.map((sample) => (pick(sample) / peak) * 100);
}

const MIN_FILL_WIDTH = 2;

export function Meter({
  theme,
  percent,
  severity,
  height,
  style,
}: {
  theme: PluginTheme;
  percent: number;
  severity?: Severity;
  height: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          height,
          borderRadius: height / 2,
          borderWidth: 1,
          borderColor: theme.colors.border,
          overflow: "hidden",
          backgroundColor: theme.colors.surface2,
        },
        style,
      ]}
    >
      <View
        style={{
          height: "100%",
          width: `${Math.min(Math.max(percent, 0), 100)}%`,
          minWidth: percent > 0 ? MIN_FILL_WIDTH : 0,
          backgroundColor: severityColor(theme, severity ?? percentSeverity(percent)),
        }}
      />
    </View>
  );
}

interface SparklineProps {
  values: readonly number[];
  color: string;
  height: number;
}

export function Sparkline({ values, color, height }: SparklineProps) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height, gap: 1 }}>
      {values.map((value, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: Math.max(1, (Math.min(value, 100) / 100) * height),
            backgroundColor: color,
            opacity: 0.6,
          }}
        />
      ))}
    </View>
  );
}

interface PreviewRowProps {
  theme: PluginTheme;
  icon: string;
  label: string;
  value: string;
  color: string;
  values: readonly number[];
  detail?: string;
}

function PreviewRow({ theme, icon, label, value, color, values, detail }: PreviewRowProps) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
        <Icon name={icon} size={ICON_SIZE} color={theme.colors.foregroundMuted} />
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>
          {label}
        </Text>
        <Text
          style={{ color: theme.colors.foreground, fontSize: FONT_SIZE, fontVariant: ["tabular-nums"] }}
        >
          {value}
        </Text>
      </View>
      {detail ? <Caption theme={theme} text={detail} /> : null}
      <Sparkline values={values} color={color} height={18} />
    </View>
  );
}

function Caption({ theme, text }: { theme: PluginTheme; text: string }) {
  return (
    <Text
      style={{ paddingLeft: ICON_SIZE + ICON_GAP, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE - 1 }}
    >
      {text}
    </Text>
  );
}

function memoryDetail(memory: HostStats["memory"]): string | undefined {
  const parts: string[] = [];
  if (memory.cachedBytes !== null) parts.push(`Cached files ${formatBytes(memory.cachedBytes)}`);
  if (memory.pressure !== null) parts.push(`pressure ${memory.pressure}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function DiskSection({ theme, disks }: { theme: PluginTheme; disks: HostStats["disks"] }) {
  const total = sumDisks(disks);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
        <Icon name="HardDrive" size={ICON_SIZE} color={theme.colors.foregroundMuted} />
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>
          Disk · {formatBytes(total.usedBytes)} / {formatBytes(total.totalBytes)}
        </Text>
        <Text
          style={{ color: theme.colors.foreground, fontSize: FONT_SIZE, fontVariant: ["tabular-nums"] }}
        >
          {formatPercent(total.percent)}
        </Text>
      </View>
      {disks.length === 1 ? <Meter theme={theme} percent={total.percent} height={METER_HEIGHT - 2} /> : null}
      {disks.length > 1
        ? disks.map((disk) => {
            const percent = diskPercent(disk);
            return (
              <View key={disk.mount} style={{ gap: 3, paddingLeft: ICON_SIZE + ICON_GAP }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
                  <Text
                    numberOfLines={1}
                    ellipsizeMode="middle"
                    style={{ flex: 1, color: theme.colors.foreground, fontSize: FONT_SIZE - 1 }}
                  >
                    {disk.mount}
                  </Text>
                  <Text
                    style={{
                      color: theme.colors.foregroundMuted,
                      fontSize: FONT_SIZE - 1,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)} ·{" "}
                    <Text
                      style={{
                        color: percent >= 70 ? loadColor(theme, percent) : theme.colors.foreground,
                      }}
                    >
                      {formatPercent(percent)}
                    </Text>
                  </Text>
                </View>
                <Meter theme={theme} percent={percent} height={METER_HEIGHT - 2} />
              </View>
            );
          })
        : null}
    </View>
  );
}

function MemoryTopSection({
  theme,
  memoryTop,
  totalBytes,
}: {
  theme: PluginTheme;
  memoryTop: HostStats["memoryTop"];
  totalBytes: number;
}) {
  const [mode, setMode] = useState<"group" | "pid">("group");
  const items = mode === "group" ? memoryTop.byGroup : memoryTop.byPid;
  if (items.length === 0) return null;

  return (
    <View style={{ gap: 5, paddingLeft: ICON_SIZE + ICON_GAP }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE - 1 }}>
          Топ процессов по ОЗУ
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {(["group", "pid"] as const).map((key) => {
            const active = mode === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                onPress={() => setMode(key)}
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 4,
                  borderWidth: 1,
                  borderColor: active ? theme.colors.accent : theme.colors.border,
                  backgroundColor: active ? theme.colors.surface2 : undefined,
                }}
              >
                <Text
                  style={{
                    color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
                    fontSize: FONT_SIZE - 2,
                  }}
                >
                  {key === "group" ? "группы" : "PID"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {items.map((item) => {
        const share = totalBytes > 0 ? (item.bytes / totalBytes) * 100 : 0;
        const scopeText = item.scope ? ` · ${item.scope}` : "";
        const suffix = mode === "group" ? (item.count > 1 ? ` ×${item.count}` : "") : ` · ${item.pid}`;
        return (
          <View key={`${mode}-${item.pid}-${item.label}-${item.scope ?? ""}`} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{ flex: 1, minWidth: 0, color: theme.colors.foreground, fontSize: FONT_SIZE - 1 }}
              >
                {item.label}
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {scopeText}
                  {suffix}
                </Text>
              </Text>
              <Text
                style={{
                  color: theme.colors.foregroundMuted,
                  fontSize: FONT_SIZE - 1,
                  fontVariant: ["tabular-nums"],
                }}
              >
                <Text style={{ color: theme.colors.foreground }}>{formatBytes(item.bytes)}</Text> ·{" "}
                {formatPercent(share)}
              </Text>
            </View>
            <Meter theme={theme} percent={share} height={3} />
          </View>
        );
      })}
    </View>
  );
}

function PublicIpsSection({
  theme,
  ips,
}: {
  theme: PluginTheme;
  ips: HostStats["publicIps"];
}) {
  const toast = useToast();
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  if (!ips || ips.length === 0) return null;

  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: ICON_GAP }}>
        <Icon name="Globe" size={ICON_SIZE} color={theme.colors.foregroundMuted} />
        <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>
          {ips.length === 1 ? "Публичный IP" : "Публичные IP"}
        </Text>
      </View>
      <View style={{ gap: 4, paddingLeft: ICON_SIZE + ICON_GAP }}>
        {ips.map((item) => {
          const isCopied = copiedIp === item.address;
          return (
            <Pressable
              key={`${item.iface}-${item.address}`}
              accessibilityRole="button"
              accessibilityLabel={`Скопировать IP ${item.address}`}
              onPress={() => {
                void copyText(item.address)
                  .then(() => {
                    setCopiedIp(item.address);
                    setTimeout(() => setCopiedIp((cur) => (cur === item.address ? null : cur)), 2000);
                    toast.show("IP скопирован в буфер", { variant: "info" });
                  })
                  .catch(() => toast.error("Не удалось скопировать IP"));
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 6,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text
                  style={{
                    color: theme.colors.foreground,
                    fontSize: FONT_SIZE,
                    fontWeight: "600",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {item.address}
                </Text>
                <Text
                  style={{
                    color: theme.colors.foregroundMuted,
                    fontSize: FONT_SIZE - 2,
                  }}
                >
                  · {item.iface}
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Icon
                  name={isCopied ? "Check" : "Copy"}
                  size={12}
                  color={isCopied ? theme.colors.statusSuccess : theme.colors.foregroundMuted}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Всплывающее окно / нижняя шторка с подробной сводкой хоста,
 * графиками и топом процессов по ОЗУ.
 */
export function HostUsagePopover({ theme, layout }: PluginPopoverProps) {
  const { data } = useHostStats(true);
  const rootStyle = {
    gap: 10,
    padding: layout.compact ? 16 : 12,
    minWidth: layout.compact ? 240 : 300,
    maxWidth: layout.compact ? undefined : 360,
    backgroundColor: theme.colors.surface1,
  };
  if (!data) {
    return (
      <View style={rootStyle}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE }}>Загрузка...</Text>
      </View>
    );
  }

  const { current, history, memory, memoryTop, network, disks, traffic24h, publicIps } = data;

  return (
    <View style={rootStyle}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: FONT_SIZE + 1, fontWeight: "600" }}>
          {data.hostname}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: FONT_SIZE - 1 }}>
          up {formatUptime(data.uptimeSeconds)} · load{" "}
          {data.loadAverage.map((n) => n.toFixed(2)).join(" ")}
        </Text>
      </View>
      <PreviewRow
        theme={theme}
        icon="Cpu"
        label={`CPU · ${data.cpuCount} cores`}
        value={formatPercent(current.cpuPercent)}
        color={loadColor(theme, current.cpuPercent)}
        values={history.map((s) => s.cpuPercent)}
      />
      <PreviewRow
        theme={theme}
        icon="MemoryStick"
        label={`RAM · ${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)}`}
        value={formatPercent(memoryPercent(memory))}
        color={severityColor(theme, memorySeverity(memory))}
        values={history.map((s) => s.memoryPercent)}
        detail={memoryDetail(memory)}
      />
      <MemoryTopSection theme={theme} memoryTop={memoryTop} totalBytes={memory.totalBytes} />
      {network ? (
        <>
          <PreviewRow
            theme={theme}
            icon="ArrowDown"
            label={
              traffic24h
                ? `Вход · ${traffic24h.complete ? "24 ч" : `за ${traffic24h.hours.toFixed(1)} ч, неполно`} · ${formatBytes(traffic24h.rx)}`
                : "Вход · сбор данных"
            }
            value={formatRate(current.rxBytesPerSec)}
            color={theme.colors.accent}
            values={scaleToPeak(history, (s) => s.rxBytesPerSec)}
          />
          <PreviewRow
            theme={theme}
            icon="ArrowUp"
            label={
              traffic24h
                ? `Выход · ${traffic24h.complete ? "24 ч" : `за ${traffic24h.hours.toFixed(1)} ч, неполно`} · ${formatBytes(traffic24h.tx)}`
                : "Выход · сбор данных"
            }
            value={formatRate(current.txBytesPerSec)}
            color={theme.colors.accent}
            values={scaleToPeak(history, (s) => s.txBytesPerSec)}
          />
        </>
      ) : null}
      {publicIps && publicIps.length > 0 ? (
        <PublicIpsSection theme={theme} ips={publicIps} />
      ) : null}
      {disks.length > 0 ? <DiskSection theme={theme} disks={disks} /> : null}
    </View>
  );
}

/**
 * Компактная полоска статуса сервера, встроенная над проектами.
 */
export function HostMetricsBar({
  theme,
  openPopover,
  enabled,
}: {
  theme: PluginTheme;
  openPopover: (Component: React.ComponentType<PluginPopoverProps>) => void;
  enabled: boolean;
}) {
  const { data } = useHostStats(enabled);
  if (!enabled || !data) return null;

  const c = theme.colors;
  const ram = memoryPercent(data.memory);
  const ramSev = memorySeverity(data.memory);
  const disk = data.disks.length > 0 ? sumDisks(data.disks) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Хост: CPU ${formatPercent(data.current.cpuPercent)}, ОЗУ ${formatPercent(ram)}`}
      onPress={() => openPopover(HostUsagePopover)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 9,
        backgroundColor: c.surface2,
        borderWidth: 1,
        borderColor: c.border,
        opacity: pressed ? 0.75 : 1,
        gap: 6,
      })}
    >
      {/* CPU */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name="Cpu" size={13} color={c.foregroundMuted} />
        <Text
          style={{
            color: loadColor(theme, data.current.cpuPercent),
            fontSize: 12,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatPercent(data.current.cpuPercent)}
        </Text>
      </View>

      {/* ОЗУ */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Icon name="MemoryStick" size={13} color={c.foregroundMuted} />
        <Text
          style={{
            color: severityColor(theme, ramSev),
            fontSize: 12,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatPercent(ram)}
        </Text>
      </View>

      {/* Сеть */}
      {data.network ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Icon name="ArrowDownUp" size={11} color={c.foregroundMuted} />
          <Text
            style={{
              color: c.foregroundMuted,
              fontSize: 11,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatCompactRate(data.current.rxBytesPerSec)}/{formatCompactRate(data.current.txBytesPerSec)}
          </Text>
        </View>
      ) : null}

      {/* Диск */}
      {disk ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon name="HardDrive" size={12} color={c.foregroundMuted} />
          <Text
            style={{
              color: disk.percent >= 80 ? loadColor(theme, disk.percent) : c.foregroundMuted,
              fontSize: 11,
              fontVariant: ["tabular-nums"],
            }}
          >
            {formatPercent(disk.percent)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
