// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { Icon, TextInput, copyText as copyToClipboard, useToast } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { InlineMarkdown } from "../markdown";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formatRatio, readBenchmark } from "../../../shared/genui/core/benchmark";
import {
  coverageTone,
  formatPercent as formatCovPercent,
  headline,
  percent as covPercent,
  rangeLabel,
  readCoverage,
} from "../../../shared/genui/core/coverage";
import { groupOutdated, readDependencies } from "../../../shared/genui/core/dependencies";
import {
  findingLocation,
  fixAllMessage,
  fixThisMessage,
  readFindings,
  severityLabel,
} from "../../../shared/genui/core/findings";
import { readLogs, type LogLevel } from "../../../shared/genui/core/logs";
import { formatAmount, formatMs, formatPercent as formatPerfPercent } from "../../../shared/genui/core/perf-units";
import { formatElapsed, jobCountsText, readPipeline } from "../../../shared/genui/core/pipeline";
import { readTrace, sourcePath } from "../../../shared/genui/core/stack-trace";
import { countsText, formatDuration, readTestRun } from "../../../shared/genui/core/test-results";
import { findNode, readTreemap, trail, visibleChildren } from "../../../shared/genui/core/treemap";
import { readWaterfall } from "../../../shared/genui/core/waterfall";
import {
  CHILD_PAGE,
  copyText as formatJsonCopy,
  defaultOpen,
  sizeText,
  visibleRows as visibleJsonRows,
} from "../../../shared/genui/logic/json-logic";
import { finiteNumber, optionalText, text, type Props } from "../../../shared/genui/logic/values";
import { ErrorLine } from "../node-renderer";
import { propsKey, toneColor, usePersistedState, useUiRuntime } from "../runtime";
import { useItemFeedback } from "./feedback";

export function Logs({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const parsed = useMemo(() => readLogs(props.output), [props.output]);
  const command = optionalText(props.command);
  const exit = finiteNumber(props.exit);
  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<LogLevel | "all">("all");

  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { output } = parsed;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return output.lines.filter((line) => {
      if (levelFilter !== "all" && line.level !== levelFilter) return false;
      if (q && !line.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [output.lines, levelFilter, query]);

  const shown = filtered.slice(-150);

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {command ? (
            <Text style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
              $ {command}
            </Text>
          ) : (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {output.lines.length} lines
            </Text>
          )}
          {exit !== null ? (
            <Text
              style={{
                color: exit === 0 ? theme.colors.statusSuccess : theme.colors.statusDanger,
                fontSize: 11.5,
                fontWeight: "600",
              }}
            >
              exit {exit}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {(["all", "error", "warn", "info"] as const).map((lvl) => (
            <Pressable
              key={lvl}
              onPress={() => setLevelFilter(lvl)}
              style={{
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 4,
                backgroundColor: levelFilter === lvl ? theme.colors.accent : theme.colors.surface1,
              }}
            >
              <Text
                style={{
                  color: levelFilter === lvl ? theme.colors.accentForeground : theme.colors.foregroundMuted,
                  fontSize: 11,
                }}
              >
                {lvl}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter logs…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={{
            color: theme.colors.foreground,
            fontSize: 12,
            paddingVertical: 2,
          }}
        />
      </View>
      <ScrollView horizontal>
        <View style={{ padding: 10, gap: 2 }}>
          {shown.map((line) => {
            const color =
              line.level === "error" || line.level === "fatal"
                ? theme.colors.statusDanger
                : line.level === "warn"
                  ? theme.colors.statusWarning
                  : theme.colors.foreground;
            return (
              <View key={line.number} style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    width: 34,
                    textAlign: "right",
                    color: theme.colors.foregroundMuted,
                    fontFamily: "monospace",
                    fontSize: 11,
                  }}
                >
                  {line.number}
                </Text>
                <Text selectable style={{ color, fontFamily: "monospace", fontSize: 11.5 }}>
                  {line.text}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

export function StackTrace({ props }: { props: Props }) {
  const { theme, openFile } = useUiRuntime();
  const parsed = useMemo(() => readTrace(props.trace), [props.trace]);
  const title = optionalText(props.title);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { trace } = parsed;

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.statusDanger,
        backgroundColor: theme.colors.surface2,
        padding: 12,
        gap: 10,
      }}
    >
      {title ? (
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>{title}</Text>
      ) : null}
      {trace.sections.map((sec, sIdx) => (
        <View key={sIdx} style={{ gap: 6 }}>
          <Text selectable style={{ color: theme.colors.statusDanger, fontSize: 13, fontWeight: "700", fontFamily: "monospace" }}>
            {sec.type ? `${sec.type}: ${sec.message}` : sec.message}
          </Text>
          <View style={{ gap: 4 }}>
            {sec.frames.slice(0, 12).map((frame, fIdx) => {
              const path = sourcePath(frame);
              return (
                <Pressable
                  key={fIdx}
                  onPress={() => {
                    if (path && openFile) void openFile(path, frame.location?.line ?? undefined);
                  }}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 4,
                    backgroundColor: frame.app ? theme.colors.surface1 : "transparent",
                  }}
                >
                  <Text
                    selectable
                    style={{
                      color: frame.app ? theme.colors.foreground : theme.colors.foregroundMuted,
                      fontFamily: "monospace",
                      fontSize: 11.5,
                    }}
                  >
                    {frame.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Findings({ props }: { props: Props }) {
  const { theme, run, openFile } = useUiRuntime();
  const parsed = useMemo(() => readFindings(props.items), [props.items]);
  const title = optionalText(props.title);
  const feedback = useItemFeedback(`findings:${propsKey(props.items)}`, {
    comments: props.comments === true,
    editable: props.editable === true,
  });
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { report } = parsed;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
          {title ?? `${report.findings.length} finding${report.findings.length === 1 ? "" : "s"}`}
        </Text>
        {report.findings.length > 1 ? (
          <Pressable
            onPress={() => {
              const msg = fixAllMessage(report.findings, report.scale);
              if (msg) void run([{ kind: "action", type: "send", text: msg }]);
            }}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: theme.colors.accent,
            }}
          >
            <Text style={{ color: theme.colors.accentForeground, fontSize: 11.5, fontWeight: "600" }}>
              Fix all
            </Text>
          </Pressable>
        ) : null}
      </View>
      {report.findings.map((item, idx) => {
        const loc = findingLocation(item);
        const original = { title: item.title, detail: item.detail ?? "" };
        const shown = feedback.fields(idx, original);
        const sevColor =
          item.severity === "critical" || item.severity === "high"
            ? theme.colors.statusDanger
            : item.severity === "medium"
              ? theme.colors.statusWarning
              : theme.colors.accent;
        return (
          <View
            key={idx}
            style={{
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              padding: 10,
              gap: 6,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>
                {shown.title}
              </Text>
              <Text style={{ color: sevColor, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                {severityLabel(item.severity, report.scale)}
              </Text>
            </View>
            {loc ? (
              <Pressable
                onPress={() => {
                  if (item.file && openFile) void openFile(item.file, item.line ?? undefined);
                }}
              >
                <Text style={{ color: theme.colors.accent, fontFamily: "monospace", fontSize: 11.5 }}>
                  {loc}
                </Text>
              </Pressable>
            ) : null}
            {shown.detail ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}><InlineMarkdown text={shown.detail} theme={theme} /></Text>
            ) : null}
            {feedback.controls(
              idx,
              `finding "${item.title}"`,
              original,
              <Pressable
                onPress={() => {
                  const msg = fixThisMessage(item);
                  void run([{ kind: "action", type: "send", text: msg }]);
                }}
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surface1,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 11.5, fontWeight: "500" }}>
                  Fix this
                </Text>
              </Pressable>,
            )}
          </View>
        );
      })}
    </View>
  );
}

export function Coverage({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const parsed = useMemo(() => readCoverage(props.report), [props.report]);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { report } = parsed;
  const totalRatio = headline(report.total, report.unit);
  const totalPct = covPercent(totalRatio);

  return (
    <View style={{ gap: 8 }}>
      {totalPct !== null ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
            Total {report.unit} coverage
          </Text>
          <Text
            style={{
              color: toneColor(theme, coverageTone(totalPct)),
              fontSize: 15,
              fontWeight: "700",
            }}
          >
            {formatCovPercent(totalPct)} ({totalRatio?.covered}/{totalRatio?.total})
          </Text>
        </View>
      ) : null}
      <View
        style={{
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: "hidden",
        }}
      >
        {report.files.slice(0, 25).map((file, idx) => {
          const ratio = headline(file, report.unit);
          const pct = covPercent(ratio) ?? 0;
          return (
            <View
              key={file.path}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.border,
                gap: 3,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, flex: 1 }}>
                  {file.path}
                </Text>
                <Text style={{ color: toneColor(theme, coverageTone(pct)), fontSize: 12, fontWeight: "600" }}>
                  {formatCovPercent(pct)}
                </Text>
              </View>
              {file.uncovered && file.uncovered.length > 0 ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
                  Uncovered lines: {file.uncovered.slice(0, 6).map(rangeLabel).join(", ")}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Dependencies({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const parsed = useMemo(() => readDependencies(props.report), [props.report]);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { report } = parsed;
  const groups = groupOutdated(report.outdated);

  return (
    <View style={{ gap: 10 }}>
      {report.vulnerable.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12.5, fontWeight: "600" }}>
            Vulnerabilities ({report.vulnerable.length})
          </Text>
          {report.vulnerable.map((v, idx) => (
            <View
              key={idx}
              style={{
                padding: 8,
                borderRadius: 6,
                backgroundColor: theme.colors.surface2,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.statusDanger,
                gap: 2,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, fontWeight: "600" }}>
                  {v.name}
                </Text>
                <Text style={{ color: theme.colors.statusDanger, fontSize: 11, fontWeight: "700" }}>
                  {v.severity}
                </Text>
              </View>
              {v.advisories[0]?.title ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
                  {v.advisories[0].title}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {groups.map((group) => (
        <View key={group.key} style={{ gap: 4 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5, fontWeight: "600", textTransform: "uppercase" }}>
            {group.key} updates ({group.packages.length})
          </Text>
          <View
            style={{
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              overflow: "hidden",
            }}
          >
            {group.packages.map((pkg, idx) => (
              <View
                key={pkg.name}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
                  {pkg.name}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12 }}>
                  {pkg.current} → <Text style={{ color: theme.colors.accent }}>{pkg.latest}</Text>
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Pipeline({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const parsed = useMemo(() => readPipeline(props.run), [props.run]);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { run } = parsed;

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        padding: 10,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
          {run.title ?? run.name ?? "Pipeline"}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
          {jobCountsText(run.counts)}
        </Text>
      </View>
      {run.stages.map((stage, sIdx) => (
        <View key={sIdx} style={{ gap: 4 }}>
          {stage.name ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5, fontWeight: "600" }}>
              {stage.name}
            </Text>
          ) : null}
          {stage.jobs.map((job, jIdx) => {
            const color =
              job.status === "success"
                ? theme.colors.statusSuccess
                : job.status === "failure"
                  ? theme.colors.statusDanger
                  : job.status === "in_progress"
                    ? theme.colors.accent
                    : theme.colors.foregroundMuted;
            return (
              <View
                key={jIdx}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingHorizontal: 8,
                  paddingVertical: 6,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surface1,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
                  {job.url ? (
                    <ExternalLink href={job.url}>
                      <Text style={{ color: theme.colors.foreground, fontSize: 12.5 }}>{job.name}</Text>
                    </ExternalLink>
                  ) : (
                    <Text style={{ color: theme.colors.foreground, fontSize: 12.5 }}>{job.name}</Text>
                  )}
                </View>
                {job.ms !== null ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
                    {formatElapsed(job.ms)}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function Benchmark({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const unit = optionalText(props.unit);
  const parsed = useMemo(() => readBenchmark(props.results, unit), [props.results, unit]);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { report } = parsed;

  if (report.kind === "compare") {
    return (
      <View
        style={{
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: "hidden",
        }}
      >
        {report.rows.map((row, idx) => {
          const color =
            row.verdict === "better"
              ? theme.colors.statusSuccess
              : row.verdict === "worse"
                ? theme.colors.statusDanger
                : theme.colors.foregroundMuted;
          return (
            <View
              key={idx}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.foreground, fontSize: 12.5, flex: 1 }}>{row.name}</Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
                {formatAmount(row.before, row.unit)} → {formatAmount(row.after, row.unit)}{" "}
                {row.percent !== null ? (
                  <Text style={{ color, fontWeight: "600" }}>({formatPerfPercent(row.percent)})</Text>
                ) : null}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  if (report.kind === "runs") {
    return (
      <View style={{ gap: 8 }}>
        {report.groups.map((group, gIdx) => (
          <View
            key={gIdx}
            style={{
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              overflow: "hidden",
            }}
          >
            {group.runs.map((run, rIdx) => (
              <View
                key={rIdx}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderTopWidth: rIdx === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 12.5, flex: 1 }}>{run.name}</Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
                  {formatAmount(run.mean, report.unit)}{" "}
                  {run.ratio > 1 ? `(${formatRatio(run.ratio, run.ratioStddev)}×)` : "(fastest)"}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      {report.runs.map((run, idx) => (
        <View
          key={idx}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12.5 }}>{run.name}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
            {Object.entries(run.values)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Waterfall({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const unit = optionalText(props.unit);
  const parsed = useMemo(() => readWaterfall(props.spans, unit), [props.spans, unit]);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { waterfall } = parsed;
  const total = Math.max(1, waterfall.total);

  return (
    <View style={{ gap: 6 }}>
      {waterfall.spans.slice(0, 40).map((span) => {
        const leftPct = Math.min(95, Math.max(0, (span.start / total) * 100));
        const widthPct = Math.min(100 - leftPct, Math.max(2, ((span.end - span.start) / total) * 100));
        return (
          <View key={span.index} style={{ gap: 2 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: theme.colors.foreground,
                  fontSize: 12,
                  paddingLeft: span.depth * 10,
                  flex: 1,
                }}
              >
                {span.name}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5, fontFamily: "monospace" }}>
                {formatMs(span.end - span.start)}
              </Text>
            </View>
            <View style={{ height: 7, borderRadius: 3.5, backgroundColor: theme.colors.surface2 }}>
              <View
                style={{
                  marginLeft: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: "100%",
                  borderRadius: 3.5,
                  backgroundColor: theme.colors.accent,
                }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function Treemap({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const unit = optionalText(props.unit);
  const parsed = useMemo(() => readTreemap(props.items, unit), [props.items, unit]);
  const [focusPath, setFocusPath] = useState("");
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { treemap } = parsed;
  const current = findNode(treemap.root, focusPath) ?? treemap.root;
  const crumbs = trail(treemap.root, current.path);
  const { nodes } = visibleChildren(current, 16);
  const total = Math.max(1, current.value);

  return (
    <View style={{ gap: 8 }}>
      {crumbs.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
          {crumbs.map((c, idx) => (
            <Pressable key={c.path} onPress={() => setFocusPath(c.path)}>
              <Text style={{ color: theme.colors.accent, fontSize: 12 }}>
                {c.name || "root"}
                {idx < crumbs.length - 1 ? " / " : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        {nodes.map((node) => {
          const pct = Math.round((node.value / total) * 100);
          return (
            <Pressable
              key={node.path}
              onPress={() => {
                if (node.children.length > 0) setFocusPath(node.path);
              }}
              style={{
                padding: 8,
                borderRadius: 6,
                backgroundColor: theme.colors.surface2,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                gap: 4,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
                  {node.name}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  {formatAmount(node.value, treemap.unit)} ({pct}%)
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface1 }}>
                <View
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    height: "100%",
                    borderRadius: 3,
                    backgroundColor: theme.colors.accent,
                  }}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Tests({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const parsed = useMemo(() => readTestRun(props.results), [props.results]);
  const title = optionalText(props.title);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { run } = parsed;

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        padding: 10,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
          {title ?? "Test results"}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {countsText(run.counts)}
          {run.ms !== null ? ` · ${formatDuration(run.ms)}` : ""}
        </Text>
      </View>
      <View style={{ gap: 4 }}>
        {run.tests.slice(0, 30).map((tc, idx) => {
          const color =
            tc.status === "passed"
              ? theme.colors.statusSuccess
              : tc.status === "failed"
                ? theme.colors.statusDanger
                : theme.colors.foregroundMuted;
          return (
            <View
              key={idx}
              style={{
                padding: 8,
                borderRadius: 6,
                backgroundColor: theme.colors.surface1,
                gap: 4,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 6, flex: 1 }}>
                  <View style={{ paddingTop: 1 }}>
                    <Icon name={tc.status === "passed" ? "CircleCheck" : tc.status === "failed" ? "CircleX" : "Circle"} size={13} color={color} />
                  </View>
                  <Text style={{ color: theme.colors.foreground, fontSize: 12.5, flex: 1 }}>{tc.name}</Text>
                </View>
                {tc.ms !== null ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
                    {formatDuration(tc.ms)}
                  </Text>
                ) : null}
              </View>
              {tc.message ? (
                <Text
                  selectable
                  style={{ color: theme.colors.statusDanger, fontFamily: "monospace", fontSize: 11.5 }}
                >
                  {tc.message}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Json({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const toast = useToast();
  const root = props.value ?? null;
  const label = optionalText(props.label);
  const initial = useMemo(() => [...defaultOpen(root)], [root]);
  const [openIds, setOpenIds] = usePersistedState<string[]>(
    `json:${propsKey(root)}`,
    initial,
    (v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null),
  );
  const openSet = useMemo(() => new Set(["$", ...openIds]), [openIds]);
  const rows = useMemo(
    () => visibleJsonRows(root, (id) => openSet.has(id), () => CHILD_PAGE),
    [root, openSet],
  );

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
          {label ?? "JSON"} · {sizeText(root)}
        </Text>
        <Pressable
          onPress={() => {
            void copyToClipboard(formatJsonCopy(root)).then(
              () => toast.show("Copied JSON", { variant: "success" }),
              () => toast.error("Could not copy"),
            );
          }}
        >
          <Icon name="Copy" size={13} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
      <View style={{ paddingVertical: 6 }}>
        {rows.slice(0, 80).map((row) => {
          if (row.type === "more") {
            return (
              <Text
                key={row.id}
                style={{
                  paddingLeft: 10 + row.depth * 14,
                  color: theme.colors.foregroundMuted,
                  fontSize: 11.5,
                }}
              >
                … {row.remaining} more
              </Text>
            );
          }
          const expandable = row.children > 0;
          const isOpen = openSet.has(row.id);
          return (
            <Pressable
              key={row.id}
              onPress={() => {
                if (!expandable) return;
                setOpenIds((prev) =>
                  prev.includes(row.id) ? prev.filter((x) => x !== row.id) : [...prev, row.id],
                );
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingLeft: 10 + row.depth * 14,
                paddingRight: 10,
                paddingVertical: 3,
                gap: 6,
              }}
            >
              {expandable ? (
                <Icon
                  name={isOpen ? "ChevronDown" : "ChevronRight"}
                  size={12}
                  color={theme.colors.foregroundMuted}
                />
              ) : (
                <View style={{ width: 12 }} />
              )}
              {row.key !== null ? (
                <Text style={{ color: theme.colors.accent, fontFamily: "monospace", fontSize: 12 }}>
                  {String(row.key)}:
                </Text>
              ) : null}
              <Text
                selectable
                numberOfLines={1}
                style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, flex: 1 }}
              >
                {expandable ? sizeText(row.value) : JSON.stringify(row.value)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
