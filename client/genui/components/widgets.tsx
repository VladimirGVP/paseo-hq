// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { hasOwnNumber } from "../../../shared/genui/logic/reply";
import { useItemFeedback } from "./feedback";
import { CheckBox } from "./inputs";
import {
  decisionMessage,
  estimateTask,
  estimateTotals,
  estimateUnit,
  formatQuantity,
  formatWithUnit,
  initialChecks,
  nudgeWeight,
  planMessage,
  planTotal,
  rankOptions,
  readDecision,
  readEstimate,
  readPlan,
  round,
  weightMax,
  weightStep,
} from "../../../shared/genui/core/decisions";
import {
  axisShare,
  formatDay,
  formatRange,
  HEALTH_LABEL,
  localDay,
  readBoard,
  readRoadmap,
  readStatus,
  ROADMAP_STATUS_LABEL,
} from "../../../shared/genui/core/tracking";
import { parseSteps } from "../../../shared/genui/logic/explain-logic";
import { finiteNumber, optionalText, text, type Props } from "../../../shared/genui/logic/values";
import {
  countdownSeconds,
  elapsedMs,
  formatClock,
  parseCards,
  parseQuestions,
  pauseClock,
  quizScore,
  remainingMs,
  startClock,
  STOPPED,
  type Clock,
} from "../../../shared/genui/logic/widget-logic";
import { InlineMarkdown, MarkdownText } from "../markdown";
import { ErrorLine } from "../node-renderer";
import { propsKey, usePersistedState, useUiRuntime } from "../runtime";

export function Timer({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const totalSeconds = finiteNumber(props.seconds);
  const label = optionalText(props.label) ?? (totalSeconds !== null ? "Timer" : "Stopwatch");
  const [clock, setClock] = useState<Clock>(STOPPED);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (clock.startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [clock.startedAt]);

  const running = clock.startedAt !== null;
  const shownSeconds =
    totalSeconds !== null
      ? countdownSeconds(remainingMs(clock, totalSeconds * 1000, now))
      : Math.floor(elapsedMs(clock, now) / 1000);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: 12,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      }}
    >
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>{label}</Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "700", fontFamily: "monospace" }}>
          {formatClock(shownSeconds)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={() => {
            const t = Date.now();
            setNow(t);
            setClock((c) => (c.startedAt === null ? startClock(c, t) : pauseClock(c, t)));
          }}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: theme.colors.accent,
          }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 12.5, fontWeight: "600" }}>
            {running ? "Pause" : "Start"}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setClock(STOPPED)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: theme.colors.surface1,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12.5 }}>Reset</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Quiz({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const { questions } = parseQuestions(props.questions);
  const [picks, setPicks] = usePersistedState<(number | null)[]>(
    `quiz:${propsKey(props.questions)}`,
    questions.map(() => null),
    (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "number" ? x : null)) : null),
  );
  if (questions.length === 0) return <ErrorLine message="Quiz has no valid questions" />;
  const answered = picks.filter((p) => p !== null).length;
  const score = quizScore(questions, picks);

  return (
    <View style={{ gap: 10 }}>
      {questions.map((q, qIdx) => {
        const picked = picks[qIdx] ?? null;
        return (
          <View
            key={qIdx}
            style={{
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              padding: 12,
              gap: 8,
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
              {qIdx + 1}. {q.q}
            </Text>
            <View style={{ gap: 6 }}>
              {q.options.map((opt, oIdx) => {
                const isPicked = picked === oIdx;
                const isCorrect = q.answer === oIdx;
                const borderColor =
                  picked === null
                    ? theme.colors.border
                    : isCorrect
                      ? theme.colors.statusSuccess
                      : isPicked
                        ? theme.colors.statusDanger
                        : theme.colors.border;
                return (
                  <Pressable
                    key={oIdx}
                    onPress={() =>
                      setPicks((prev) => {
                        const copy = [...prev];
                        copy[qIdx] = oIdx;
                        return copy;
                      })
                    }
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 7,
                      borderRadius: 6,
                      borderWidth: isPicked || (picked !== null && isCorrect) ? 1.5 : StyleSheet.hairlineWidth,
                      borderColor,
                      backgroundColor: theme.colors.surface1,
                    }}
                  >
                    <Text style={{ color: theme.colors.foreground, fontSize: 12.5 }}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>
            {picked !== null && q.why ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{q.why}</Text>
            ) : null}
          </View>
        );
      })}
      {answered > 0 ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Score: {score} / {questions.length}
        </Text>
      ) : null}
    </View>
  );
}

export function Flashcards({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const cards = parseCards(props.cards);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  if (cards.length === 0) return <ErrorLine message="Flashcards has no valid cards" />;
  const card = cards[Math.min(index, cards.length - 1)]!;

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={() => setFlipped((f) => !f)}
        style={{
          minHeight: 110,
          borderRadius: 10,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          padding: 16,
          justifyContent: "center",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {flipped ? "Back" : "Front"} · Card {index + 1} of {cards.length} (tap to flip)
        </Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600", textAlign: "center" }}>
          {flipped ? card.back : card.front}
        </Text>
      </Pressable>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Pressable
          onPress={() => {
            setFlipped(false);
            setIndex((i) => (i > 0 ? i - 1 : cards.length - 1));
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: theme.colors.surface2 }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Previous</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setFlipped(false);
            setIndex((i) => (i + 1) % cards.length);
          }}
          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: theme.colors.surface2 }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Walkthrough({ props }: { props: Props }) {
  const { theme, compact } = useUiRuntime();
  const { steps } = parseSteps(props.steps);
  const [stepIdx, setStepIdx] = useState(0);
  if (steps.length === 0) return <ErrorLine message="Walkthrough has no steps" />;
  const current = steps[Math.min(stepIdx, steps.length - 1)]!;

  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        padding: 12,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13.5, fontWeight: "600" }}>
          {current.title || `Step ${stepIdx + 1}`}
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
          {stepIdx + 1} / {steps.length}
        </Text>
      </View>
      {current.body ? <MarkdownText text={current.body} theme={theme} compact={compact} /> : null}
      {current.code ? (
        <View
          style={{
            borderRadius: 6,
            backgroundColor: theme.colors.surface1,
            padding: 10,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>
            {current.code}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Pressable
          disabled={stepIdx === 0}
          onPress={() => setStepIdx((i) => Math.max(0, i - 1))}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 6,
            backgroundColor: theme.colors.surface1,
            opacity: stepIdx === 0 ? 0.4 : 1,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>Back</Text>
        </Pressable>
        <Pressable
          disabled={stepIdx >= steps.length - 1}
          onPress={() => setStepIdx((i) => Math.min(steps.length - 1, i + 1))}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 6,
            backgroundColor: theme.colors.accent,
            opacity: stepIdx >= steps.length - 1 ? 0.4 : 1,
          }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" }}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Plan({ props }: { props: Props }) {
  const { theme, run, answer } = useUiRuntime();
  const { steps, error } = readPlan(props.steps);
  const submitLabel = optionalText(props.submit) ?? "Approve plan";
  const [checked, setChecked] = usePersistedState<boolean[]>(
    `plan:${propsKey(props.steps)}`,
    initialChecks(steps),
    (v) => (Array.isArray(v) ? v.map(Boolean) : null),
  );
  const feedback = useItemFeedback(`plan:${propsKey(props.steps)}`, {
    comments: props.comments === true,
    editable: props.editable === true,
  });
  if (error) return <ErrorLine message={error} />;
  const total = planTotal(steps, checked);

  return (
    <View style={{ gap: 8 }}>
      {steps.map((step, idx) => {
        const isOn = checked[idx] !== false;
        const original = { title: step.title, detail: step.detail ?? "" };
        const shown = feedback.fields(idx, original);
        const toggle = () =>
          setChecked((prev) => {
            const next = [...prev];
            next[idx] = !isOn;
            return next;
          });
        return (
          <View
            key={idx}
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
              padding: 10,
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: isOn }} onPress={toggle} style={{ paddingTop: 1 }}>
              <CheckBox checked={isOn} />
            </Pressable>
            <View style={{ flex: 1, gap: 4 }}>
              <Pressable onPress={toggle} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>
                  {hasOwnNumber(shown.title) ? shown.title : `${idx + 1}. ${shown.title}`}
                </Text>
                {step.estimate ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
                    {step.estimate}
                  </Text>
                ) : null}
              </Pressable>
              {shown.detail ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}><InlineMarkdown text={shown.detail} theme={theme} /></Text>
              ) : null}
              {step.files.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {step.files.map((f, fIdx) => (
                    <Text
                      key={fIdx}
                      style={{ color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 11 }}
                    >
                      {f.line === null ? f.path : `${f.path}:${f.line}`}
                    </Text>
                  ))}
                </View>
              ) : null}
              {feedback.controls(idx, hasOwnNumber(step.title) ? `step "${step.title}"` : `step ${idx + 1} (${step.title})`, original)}
            </View>
          </View>
        );
      })}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {total.total ? `Estimated total: ${formatQuantity(total.total)}` : `${checked.filter(Boolean).length} steps selected`}
        </Text>
        {answer ? (
          <Text style={{ color: theme.colors.statusSuccess, fontSize: 12 }}>Approved</Text>
        ) : (
          <Pressable
            onPress={() => {
              const msg = planMessage(steps, checked, "");
              if (msg) void run([{ kind: "action", type: "send", text: msg }]);
            }}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 8,
              backgroundColor: theme.colors.accent,
            }}
          >
            <Text style={{ color: theme.colors.accentForeground, fontSize: 12.5, fontWeight: "600" }}>
              {submitLabel}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export function Decision({ props }: { props: Props }) {
  const { theme, run } = useUiRuntime();
  const feedback = useItemFeedback(`decision:${propsKey(props.options)}`, { comments: props.comments === true, editable: false });
  const parsed = readDecision(props.options, props.criteria);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const { model } = parsed;
  const [weights, setWeights] = usePersistedState<number[]>(
    `decision:${propsKey(props)}`,
    model.criteria.map((c) => c.weight),
    (v) => (Array.isArray(v) && v.length === model.criteria.length ? v.map((n) => Number(n) || 0) : null),
  );

  const ranked = rankOptions(model, weights);
  const step = weightStep(weights);
  const maxW = weightMax(weights);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 6 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5, fontWeight: "600" }}>
          Criteria weights
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {model.criteria.map((c, cIdx) => {
            const w = weights[cIdx] ?? c.weight;
            return (
              <View
                key={cIdx}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 8,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{c.name}</Text>
                <Pressable
                  onPress={() =>
                    setWeights((prev) =>
                      prev.map((val, i) => (i === cIdx ? nudgeWeight(val, -1, step, maxW) : val)),
                    )
                  }
                >
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, paddingHorizontal: 4 }}>−</Text>
                </Pressable>
                <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600", fontFamily: "monospace" }}>
                  {round(w, 2)}
                </Text>
                <Pressable
                  onPress={() =>
                    setWeights((prev) =>
                      prev.map((val, i) => (i === cIdx ? nudgeWeight(val, 1, step, maxW) : val)),
                    )
                  }
                >
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, paddingHorizontal: 4 }}>+</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        {ranked.map((entry, rIdx) => {
          const opt = model.options[entry.index]!;
          const isLeader = rIdx === 0;
          return (
            <View
              key={entry.index}
              style={{
                borderRadius: 8,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
                padding: 10,
                gap: 6,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 13.5, fontWeight: "600" }}>
                  {opt.name}
                </Text>
                <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: isLeader ? "700" : "500" }}>
                  {round(entry.total, 2)} / {model.scale}
                </Text>
              </View>
              {opt.pros.length > 0 ? (
                <Text style={{ color: theme.colors.statusSuccess, fontSize: 12 }}>
                  + {opt.pros.join(" · ")}
                </Text>
              ) : null}
              {opt.cons.length > 0 ? (
                <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
                  − {opt.cons.join(" · ")}
                </Text>
              ) : null}
              <Pressable
                onPress={() => {
                  const msg = decisionMessage(model, entry.index, weights);
                  void run([{ kind: "action", type: "send", text: msg }]);
                }}
                style={{
                  alignSelf: "flex-start",
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: isLeader ? theme.colors.accent : theme.colors.surface1,
                }}
              >
                <Text
                  style={{
                    color: isLeader ? theme.colors.accentForeground : theme.colors.foreground,
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  Go with {opt.name}
                </Text>
              </Pressable>
              {feedback.controls(entry.index, `option "${opt.name}"`, {})}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Estimate({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const { tasks, error } = readEstimate(props.tasks);
  if (error) return <ErrorLine message={error} />;
  const unit = estimateUnit(props.unit);
  const estimates = tasks.map(estimateTask);
  const totals = estimateTotals(estimates);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>P50 (Expected)</Text>
          <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "700" }}>
            {formatWithUnit(totals.p50, unit)}
          </Text>
        </View>
        <View style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>P80</Text>
          <Text style={{ color: theme.colors.accent, fontSize: 16, fontWeight: "700" }}>
            {formatWithUnit(totals.p80, unit)}
          </Text>
        </View>
        <View style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface2 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>P90 (Safe)</Text>
          <Text style={{ color: theme.colors.statusWarning, fontSize: 16, fontWeight: "700" }}>
            {formatWithUnit(totals.p90, unit)}
          </Text>
        </View>
      </View>
      <View
        style={{
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          overflow: "hidden",
        }}
      >
        {estimates.map((est, idx) => (
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
            <Text style={{ color: theme.colors.foreground, fontSize: 12.5, flex: 1 }}>
              {est.task.title}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
              {est.error
                ? est.error
                : `${est.task.low} / ${round(est.likely, 1)} / ${est.task.high} ${unit}`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Board({ props }: { props: Props }) {
  const { theme, compact } = useUiRuntime();
  const parsed = readBoard(props.items, props.columns);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const board = parsed.value;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={!compact}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {board.columns.map((col) => (
          <View
            key={col.status}
            style={{
              width: 230,
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              padding: 8,
              gap: 6,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "600" }}>
                {col.label}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
                {col.cards.length}
              </Text>
            </View>
            {col.cards.map((card) => (
              <View
                key={card.id}
                style={{
                  borderRadius: 6,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                  padding: 8,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 6 }}>
                  {card.key ? (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
                      {card.key}
                    </Text>
                  ) : null}
                  {card.priority ? (
                    <Text style={{ color: theme.colors.accent, fontSize: 10.5 }}>{card.priority}</Text>
                  ) : null}
                </View>
                {card.url ? (
                  <ExternalLink href={card.url}>
                    <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "500" }}>
                      {card.title}
                    </Text>
                  </ExternalLink>
                ) : (
                  <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "500" }}>
                    {card.title}
                  </Text>
                )}
                {card.owners.length > 0 ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                    {card.owners.join(", ")}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

export function Roadmap({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const today = useMemo(() => localDay(new Date()), []);
  const parsed = readRoadmap(props.items, today);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const roadmap = parsed.value;

  return (
    <View style={{ gap: 8 }}>
      {roadmap.lanes.map((lane, lIdx) => (
        <View
          key={lIdx}
          style={{
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface2,
            padding: 10,
            gap: 8,
          }}
        >
          {lane.name ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5, fontWeight: "600" }}>
              {lane.name}
            </Text>
          ) : null}
          {lane.items.map((item) => {
            const leftPct = Math.max(0, Math.min(95, axisShare(item.start, roadmap) * 100));
            const rightPct = Math.max(leftPct + 3, Math.min(100, axisShare(item.end + 1, roadmap) * 100));
            const widthPct = Math.max(3, rightPct - leftPct);
            const barColor =
              item.status === "done"
                ? theme.colors.statusSuccess
                : item.status === "blocked" || item.status === "at-risk"
                  ? theme.colors.statusWarning
                  : theme.colors.accent;
            return (
              <View key={item.index} style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "500" }}>
                    {item.title}
                  </Text>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
                    {formatRange(item.start, item.end, today)} · {ROADMAP_STATUS_LABEL[item.status]}
                  </Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surface1 }}>
                  <View
                    style={{
                      marginLeft: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: "100%",
                      borderRadius: 4,
                      backgroundColor: barColor,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function Status({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const today = useMemo(() => localDay(new Date()), []);
  const parsed = readStatus(props.items, today);
  if (!parsed.ok) return <ErrorLine message={parsed.error} />;
  const report = parsed.value;

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      {report.items.map((item, idx) => {
        const color =
          item.status === "on-track" || item.status === "done"
            ? theme.colors.statusSuccess
            : item.status === "at-risk"
              ? theme.colors.statusWarning
              : item.status === "off-track" || item.status === "blocked"
                ? theme.colors.statusDanger
                : theme.colors.foregroundMuted;
        return (
          <View
            key={item.index}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
              gap: 3,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
                {item.name}
              </Text>
              <Text style={{ color, fontSize: 11.5, fontWeight: "600" }}>
                {item.status ? HEALTH_LABEL[item.status] : item.given ?? "Unknown"}
                {item.progress !== null ? ` (${Math.round(item.progress)}%)` : ""}
              </Text>
            </View>
            {item.note || item.owner || item.due !== null ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {[
                  item.owner,
                  item.due !== null ? `Due ${formatDay(item.due, today)}` : null,
                  item.note,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
