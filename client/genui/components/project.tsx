// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { Icon } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { acceptanceVerdict, checkLabel, readAcceptance, verdictLine } from "../../../shared/genui/core/acceptance";
import { readCompare } from "../../../shared/genui/core/compare";
import {
  changeTotals,
  checkCounts,
  parseChangesTarget,
  parseCommitLimit,
  parsePathFilter,
  parseThreadIds,
  scopeLabel,
  threadStatusLabel,
  type ChangesResult,
  type CommitsResult,
  type EnvironmentsResult,
  type PullRequestResult,
  type ThreadsResult,
} from "../../../shared/genui/core/project";
import { chainSummary, mismatchText, readProvenance } from "../../../shared/genui/core/provenance";
import { analyse, countsText as werCountsText, formatWer, readTracks } from "../../../shared/genui/core/transcript";
import { optionalText, type Props } from "../../../shared/genui/logic/values";
import { useProjectRpc } from "../loaders";
import { ErrorLine } from "../node-renderer";
import { useUiRuntime } from "../runtime";
import { LoadedImageView } from "./content";
import { Diff } from "./data";

const CHANGES_ROWS = 50;

export function Changes({ props }: { props: Props }) {
  const { theme, agentId, blockKey } = useUiRuntime();
  const projectRpc = useProjectRpc();
  const rawTarget = optionalText(props.target);
  const parsedPaths = parsePathFilter(props.paths);
  const [state, setState] = useState<ChangesResult | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  // Keyed by the request so a new target or path filter starts collapsed again.
  const requestKey = `${rawTarget ?? ""}|${JSON.stringify(parsedPaths.ok ? parsedPaths.value : null)}`;
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const showAll = expandedFor === requestKey;

  useEffect(() => {
    const parsedTarget = parseChangesTarget(rawTarget);
    if (!parsedTarget.ok || !parsedPaths.ok) return;
    let live = true;
    void projectRpc
      .changes({
        agentId: agentId ?? "gallery",
        target: rawTarget,
        paths: parsedPaths.value ? [...parsedPaths.value] : null,
        blockKey,
        refresh: false,
      })
      .then((res) => {
        if (live) setState(res);
      });
    return () => {
      live = false;
    };
  }, [agentId, blockKey, parsedPaths, projectRpc, rawTarget]);

  if (!parsedPaths.ok) return <ErrorLine message={parsedPaths.error} />;
  if (state === null) {
    return (
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Reading changes…</Text>
      </View>
    );
  }
  if (!state.ok) return <ErrorLine message={state.message} />;

  const totals = changeTotals(state.files);
  const patchByPath = new Map(state.patches.map((p) => [p.path, p.patch]));
  const shownFiles = showAll ? state.files : state.files.slice(0, CHANGES_ROWS);
  const hiddenFiles = state.files.length - shownFiles.length;

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
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
          {scopeLabel(state.scope)}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
          {totals.files} files ·{" "}
          <Text style={{ color: theme.colors.statusSuccess }}>+{totals.additions}</Text>{" "}
          <Text style={{ color: theme.colors.statusDanger }}>−{totals.deletions}</Text>
        </Text>
      </View>
      {shownFiles.map((file, idx) => {
        const patch = patchByPath.get(file.path);
        const isOpen = expandedFile === file.path;
        return (
          <View
            key={file.path}
            style={{
              borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
            }}
          >
            <Pressable
              onPress={() => setExpandedFile(isOpen ? null : file.path)}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingHorizontal: 10,
                paddingVertical: 7,
              }}
            >
              <Text style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, flex: 1 }}>
                {file.path}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12 }}>
                <Text style={{ color: theme.colors.statusSuccess }}>+{file.additions}</Text>{" "}
                <Text style={{ color: theme.colors.statusDanger }}>−{file.deletions}</Text>
              </Text>
            </Pressable>
            {isOpen && patch ? (
              <View style={{ paddingHorizontal: 10, paddingBottom: 8 }}>
                <Diff props={{ patch }} />
              </View>
            ) : null}
          </View>
        );
      })}
      {hiddenFiles > 0 ? (
        <Pressable
          onPress={() => setExpandedFor(requestKey)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            Show {hiddenFiles} more file{hiddenFiles === 1 ? "" : "s"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Commits({ props }: { props: Props }) {
  const { theme, agentId, blockKey } = useUiRuntime();
  const projectRpc = useProjectRpc();
  const limitParsed = parseCommitLimit(props.limit);
  const [state, setState] = useState<CommitsResult | null>(null);

  useEffect(() => {
    if (!limitParsed.ok) return;
    let live = true;
    void projectRpc
      .commits({ agentId: agentId ?? "gallery", blockKey, refresh: false })
      .then((res) => {
        if (live) setState(res);
      });
    return () => {
      live = false;
    };
  }, [agentId, blockKey, limitParsed.ok, projectRpc]);

  if (!limitParsed.ok) return <ErrorLine message={limitParsed.error} />;
  if (state === null) {
    return (
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Reading commits…</Text>
      </View>
    );
  }
  if (!state.ok) return <ErrorLine message={state.message} />;

  const commits = limitParsed.value ? state.commits.slice(0, limitParsed.value) : state.commits;

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
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
          {state.branch ?? "HEAD"} vs {state.base}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {commits.length} commit{commits.length === 1 ? "" : "s"}
        </Text>
      </View>
      {commits.map((c, idx) => (
        <View
          key={c.sha}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 10,
            paddingVertical: 7,
            borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.accent, fontFamily: "monospace", fontSize: 12 }}>
            {c.shortSha}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 12.5, flex: 1 }}>
            {c.subject}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>{c.author}</Text>
        </View>
      ))}
    </View>
  );
}

export function PullRequest() {
  const { theme, agentId } = useUiRuntime();
  const projectRpc = useProjectRpc();
  const [state, setState] = useState<PullRequestResult | null>(null);

  useEffect(() => {
    let live = true;
    void projectRpc.pullRequest({ agentId: agentId ?? "gallery" }).then((res) => {
      if (live) setState(res);
    });
    return () => {
      live = false;
    };
  }, [agentId, projectRpc]);

  if (state === null) {
    return (
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Reading pull request…</Text>
      </View>
    );
  }
  if (!state.ok) return <ErrorLine message={state.message} />;
  if (!state.pullRequest) {
    return (
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          No open pull request for {state.branch ?? "this branch"}
        </Text>
      </View>
    );
  }

  const pr = state.pullRequest;
  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        padding: 12,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <ExternalLink href={pr.url}>
          <Text style={{ color: theme.colors.accent, fontSize: 13.5, fontWeight: "600" }}>
            #{pr.number} {pr.title}
          </Text>
        </ExternalLink>
        <Text style={{ color: theme.colors.statusSuccess, fontSize: 11.5, fontWeight: "600" }}>
          {pr.state}
        </Text>
      </View>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {pr.headRef} → {pr.baseRef} · Checks: {checkCounts(pr.checks)} · Review: {pr.review.state}
      </Text>
    </View>
  );
}

export function Threads({ props }: { props: Props }) {
  const { theme, agentId } = useUiRuntime();
  const projectRpc = useProjectRpc();
  const parsedIds = parseThreadIds(props.ids);
  const [state, setState] = useState<ThreadsResult | null>(null);

  useEffect(() => {
    if (!parsedIds.ok) return;
    let live = true;
    void projectRpc
      .threads({
        agentId: agentId ?? "gallery",
        ids: parsedIds.value ? [...parsedIds.value] : null,
      })
      .then((res) => {
        if (live) setState(res);
      });
    return () => {
      live = false;
    };
  }, [agentId, parsedIds, projectRpc]);

  if (!parsedIds.ok) return <ErrorLine message={parsedIds.error} />;
  if (state === null) {
    return (
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Reading threads…</Text>
      </View>
    );
  }
  if (!state.ok) return <ErrorLine message={state.message} />;

  return (
    <View style={{ gap: 6 }}>
      {state.threads.map((t) =>
        t.found ? (
          <View
            key={t.id}
            style={{
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              padding: 10,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>
                {t.title}
              </Text>
              <Text style={{ color: theme.colors.accent, fontSize: 11.5 }}>
                {threadStatusLabel(t)}
              </Text>
            </View>
            {t.lastMessage ? (
              <Text numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {t.lastMessage.text}
              </Text>
            ) : null}
          </View>
        ) : (
          <ErrorLine key={t.id} message={`Thread ${t.id} not found`} />
        ),
      )}
    </View>
  );
}

export function Environments() {
  const { theme, agentId } = useUiRuntime();
  const projectRpc = useProjectRpc();
  const [state, setState] = useState<EnvironmentsResult | null>(null);

  useEffect(() => {
    let live = true;
    void projectRpc.environments({ agentId: agentId ?? "gallery" }).then((res) => {
      if (live) setState(res);
    });
    return () => {
      live = false;
    };
  }, [agentId, projectRpc]);

  if (state === null) {
    return (
      <View style={{ padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Reading environments…</Text>
      </View>
    );
  }
  if (!state.ok) return <ErrorLine message={state.message} />;

  return (
    <View style={{ gap: 6 }}>
      {state.environments.map((env) => (
        <View
          key={env.id}
          style={{
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface2,
            padding: 10,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
              {env.name ?? env.id} {env.branch ? `(${env.branch})` : ""}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
              {env.kind} · {env.threadCounts.live} active
            </Text>
          </View>
          {env.path ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 11.5 }}>
              {env.path}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function Acceptance({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const parsed = useMemo(
    () => readAcceptance(props.criteria, props.columns),
    [props.criteria, props.columns],
  );
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { report } = parsed;
  const verdict = acceptanceVerdict(report);

  return (
    <View style={{ gap: 8 }}>
      <View
        style={{
          padding: 10,
          borderRadius: 8,
          backgroundColor: theme.colors.surface2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
          {verdictLine(verdict)}
        </Text>
      </View>
      <View
        style={{
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: "hidden",
        }}
      >
        {report.criteria.map((crit, idx) => (
          <View
            key={idx}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
              gap: 4,
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
              {crit.name}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(crit.cells ?? [crit.own]).map((chk, cIdx) => {
                const color =
                  chk.status === "passed"
                    ? theme.colors.statusSuccess
                    : chk.status === "failed"
                      ? theme.colors.statusDanger
                      : chk.status === "claimed" || chk.status === "blocked"
                        ? theme.colors.statusWarning
                        : theme.colors.foregroundMuted;
                return (
                  <Text key={cIdx} style={{ color, fontSize: 11.5 }}>
                    {report.columns[cIdx] ? `${report.columns[cIdx]}: ` : ""}
                    {checkLabel(chk)}
                  </Text>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Compare({ props }: { props: Props }) {
  const { theme, compact } = useUiRuntime();
  const parsed = useMemo(() => readCompare(props.images), [props.images]);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { images } = parsed;

  return (
    <View style={{ flexDirection: compact ? "column" : "row", gap: 10 }}>
      {images.map((img, idx) => (
        <View
          key={idx}
          style={{
            flex: 1,
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface2,
            padding: 8,
            gap: 4,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600" }}>
            {img.label}
          </Text>
          <LoadedImageView src={img.src} alt={img.label} height={180} />
        </View>
      ))}
    </View>
  );
}

export function Transcript({ props }: { props: Props }) {
  const { theme, loadAudio, playAudio } = useUiRuntime();
  const parsed = useMemo(() => readTracks(props.tracks), [props.tracks]);
  const audioPath = optionalText(props.audio);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const analysis = useMemo(() => analyse(parsed.tracks), [parsed.tracks]);

  return (
    <View style={{ gap: 8 }}>
      {audioPath && loadAudio && playAudio ? (
        <Pressable
          onPress={() => {
            void loadAudio(audioPath).then((res) => {
              if (res.ok) void playAudio(res.url);
            });
          }}
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 6,
            backgroundColor: theme.colors.accent,
          }}
        >
          <Icon name="Play" size={12} color={theme.colors.accentForeground} />
          <Text style={{ color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" }}>
            Play recording
          </Text>
        </Pressable>
      ) : null}
      {parsed.tracks.map((track, idx) => {
        const comp = idx > 0 && analysis ? analysis.comparisons[idx - 1] : null;
        return (
          <View
            key={idx}
            style={{
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              padding: 10,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
                {track.name}
              </Text>
              {comp ? (
                <Text style={{ color: theme.colors.accent, fontSize: 11.5 }}>
                  {comp.wer !== null ? `WER ${formatWer(comp.wer)} · ` : ""}
                  {werCountsText(comp.counts)}
                </Text>
              ) : (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>Reference</Text>
              )}
            </View>
            <Text selectable style={{ color: theme.colors.foreground, fontSize: 12.5, lineHeight: 19 }}>
              {track.words.map((w) => w.text).join(" ")}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function Provenance({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const parsed = useMemo(
    () => readProvenance(props.stages, props.expected),
    [props.stages, props.expected],
  );
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { provenance } = parsed;

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
        {chainSummary(provenance)}
      </Text>
      {provenance.mismatches.map((m, idx) => (
        <View
          key={idx}
          style={{
            padding: 8,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.statusDanger,
          }}
        >
          <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
            {mismatchText(provenance.stages, m)}
          </Text>
        </View>
      ))}
      <View style={{ gap: 6 }}>
        {provenance.stages.map((stage, idx) => (
          <View
            key={idx}
            style={{
              padding: 10,
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              gap: 4,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
                {idx + 1}. {stage.name}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>{stage.status}</Text>
            </View>
            {stage.facts.length > 0 ? (
              <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 11.5, fontFamily: "monospace" }}>
                {stage.facts.map((f) => `${f.key}: ${f.value}`).join(" · ")}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
