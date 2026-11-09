// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { InlineMarkdown } from "../markdown";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { formMessage } from "../../../shared/genui/core/form";
import type { Action, Scalar, UiNode, Value } from "../../../shared/genui/core/types";
import {
  blankRow,
  cardOptions,
  followUpPrompts,
  parseNumberInput,
  sameColor,
  setCell,
  swatchColors,
  tableColumns,
  tableRows,
  togglePick,
} from "../../../shared/genui/logic/choose-logic";
import {
  addItem,
  itemText,
  radioOptions,
  stepBy,
  stepperValue,
  stepRange,
} from "../../../shared/genui/logic/fieldLogic";
import { resolveIconName } from "../../../shared/genui/logic/icons";
import {
  finiteNumber,
  formatNumber,
  isAction,
  isBinding,
  isScalar,
  list,
  nodes,
  optionalText,
  text,
  type Props,
} from "../../../shared/genui/logic/values";
import { ErrorLine, RenderNodes, type GroupedButton } from "../node-renderer";
import { propsKey, useUiRuntime } from "../runtime";
import { useItemFeedback } from "./feedback";
import { LoadedImageView } from "./content";

function FieldLabel({ label, value }: { label: string | null; value?: string }) {
  const { theme } = useUiRuntime();
  if (!label && !value) return null;
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      {label ? (
        <Text style={{ color: theme.colors.foreground, fontSize: 12.5, fontWeight: "500" }}>{label}</Text>
      ) : (
        <View />
      )}
      {value !== undefined ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
          {value}
        </Text>
      ) : null}
    </View>
  );
}

export function Slider({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Slider expects a $state binding" />;
  const min = finiteNumber(props.min) ?? 0;
  const max = Math.max(min, finiteNumber(props.max) ?? 100);
  const step = Math.max(0.0001, finiteNumber(props.step) ?? 1);
  const label = optionalText(props.label);
  const current = Math.min(max, Math.max(min, finiteNumber(binding.value) ?? min));
  const span = Math.max(0.0001, max - min);
  const pct = Math.min(100, Math.max(0, ((current - min) / span) * 100));
  const range = stepRange(min, max, step);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const raw = min + t * span;
    const snapped = Math.round((raw - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
  });

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} value={formatNumber(current)} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setValue(binding.name, stepBy(current, -1, range))}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>−</Text>
        </Pressable>
        <Pressable
          style={{
            flex: 1,
            height: 10,
            borderRadius: 5,
            backgroundColor: theme.colors.surface2,
            overflow: "hidden",
          }}
          onPress={(e) => {
            const locX = (e.nativeEvent as { locationX?: number }).locationX;
            if (typeof locX === "number" && locX >= 0) {
              const ratio = Math.min(1, Math.max(0, locX / 200));
              const next = Math.round(((min + ratio * span) - min) / step) * step + min;
              setValue(binding.name, Math.min(max, Math.max(min, Number(next.toFixed(6)))));
            }
          }}
        >
          <View
            style={{
              width: `${pct}%`,
              height: "100%",
              backgroundColor: theme.colors.accent,
              borderRadius: 5,
            }}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setValue(binding.name, stepBy(current, 1, range))}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>+</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {ticks.map((val, idx) => (
          <Pressable key={idx} onPress={() => setValue(binding.name, val)}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10.5 }}>
              {formatNumber(val)}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Stepper({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Stepper expects a $state binding" />;
  const range = stepRange(props.min, props.max, props.step);
  const current = stepperValue(binding.value, range);
  const label = optionalText(props.label);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      {label ? (
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500", flex: 1 }}>
          {label}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setValue(binding.name, stepBy(current, -1, range))}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 15 }}>−</Text>
        </Pressable>
        <Text
          style={{
            minWidth: 36,
            textAlign: "center",
            color: theme.colors.foreground,
            fontSize: 13.5,
            fontWeight: "600",
            fontFamily: "monospace",
          }}
        >
          {formatNumber(current)}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setValue(binding.name, stepBy(current, 1, range))}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 15 }}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Toggle({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Toggle expects a $state binding" />;
  const checked = Boolean(binding.value);
  const label = text(props.label);

  return (
    <Pressable
      accessibilityRole="switch"
      onPress={() => setValue(binding.name, !checked)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingVertical: 4,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 13, flex: 1 }}>{label}</Text>
      <View
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          backgroundColor: checked ? theme.colors.accent : theme.colors.surface2,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: checked ? theme.colors.accent : theme.colors.border,
          padding: 2,
          justifyContent: "center",
          alignItems: checked ? "flex-end" : "flex-start",
        }}
      >
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: checked ? theme.colors.accentForeground : theme.colors.foregroundMuted,
          }}
        />
      </View>
    </Pressable>
  );
}

export function Choice({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Choice expects a $state binding" />;
  const options = list(props.options).filter(isScalar);
  const label = optionalText(props.label);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
          backgroundColor: theme.colors.surface2,
          padding: 4,
          borderRadius: 8,
        }}
      >
        {options.map((opt, idx) => {
          const active = binding.value === opt;
          return (
            <Pressable
              key={idx}
              accessibilityRole="button"
              onPress={() => setValue(binding.name, opt)}
              style={{
                flex: 1,
                minWidth: 72,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 6,
                backgroundColor: active ? theme.colors.accent : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: active ? theme.colors.accentForeground : theme.colors.foreground,
                  fontSize: 12.5,
                  fontWeight: active ? "600" : "400",
                }}
              >
                {itemText(opt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Radio({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Radio expects a $state binding" />;
  const options = radioOptions(props.options);
  const label = optionalText(props.label);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} />
      <View style={{ gap: 6 }}>
        {options.map((opt, idx) => {
          const active = binding.value === opt.value;
          return (
            <Pressable
              key={idx}
              accessibilityRole="radio"
              onPress={() => setValue(binding.name, opt.value)}
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
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: active ? theme.colors.accent : theme.colors.foregroundMuted,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 2,
                }}
              >
                {active ? (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.colors.accent,
                    }}
                  />
                ) : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}>
                  {itemText(opt.value)}
                </Text>
                {opt.detail ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    <InlineMarkdown text={opt.detail} theme={theme} />
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Select({ props }: { props: Props }) {
  return <Choice props={props} />;
}

export function Checklist({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Checklist expects a $state binding" />;
  const picked = Array.isArray(binding.value) ? binding.value : [];
  const options = list(props.options).filter(isScalar);
  const label = optionalText(props.label);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} />
      <View style={{ gap: 6 }}>
        {options.map((opt, idx) => {
          const checked = picked.includes(opt);
          return (
            <Pressable
              key={idx}
              accessibilityRole="checkbox"
              onPress={() => setValue(binding.name, togglePick(picked, opt, options))}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <CheckBox checked={checked} />
              <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{itemText(opt)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ListEditor({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  const [draft, setDraft] = useState("");
  if (!binding) return <ErrorLine message="ListEditor expects a $state binding" />;
  const items = Array.isArray(binding.value) ? binding.value : [];
  const label = optionalText(props.label);
  const placeholder = optionalText(props.placeholder) ?? "Add item…";

  const add = () => {
    const next = addItem(items, draft);
    if (next) {
      setValue(binding.name, next);
      setDraft("");
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} />
      <View style={{ gap: 4 }}>
        {items.map((item, idx) => (
          <View
            key={idx}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
              backgroundColor: theme.colors.surface2,
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 12.5 }}>{itemText(item)}</Text>
            <Pressable
              onPress={() => setValue(binding.name, items.filter((_, i) => i !== idx))}
            >
              <Icon name="X" size={13} color={theme.colors.foregroundMuted} />
            </Pressable>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.foregroundMuted}
          onSubmitEditing={add}
          style={{
            flex: 1,
            borderRadius: 6,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface2,
            color: theme.colors.foreground,
            paddingHorizontal: 10,
            paddingVertical: 6,
            fontSize: 13,
          }}
        />
        <Pressable
          onPress={add}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: theme.colors.accent,
            justifyContent: "center",
          }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 12.5, fontWeight: "600" }}>
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Input({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Input expects a $state binding" />;
  const label = optionalText(props.label);
  const placeholder = optionalText(props.placeholder) ?? "";

  return (
    <View style={{ gap: 5 }}>
      <FieldLabel label={label} />
      <TextInput
        value={text(binding.value)}
        onChangeText={(next) => setValue(binding.name, next)}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          color: theme.colors.foreground,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 13,
        }}
      />
    </View>
  );
}

export function TextArea({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="TextArea expects a $state binding" />;
  const label = optionalText(props.label);
  const placeholder = optionalText(props.placeholder) ?? "";

  return (
    <View style={{ gap: 5 }}>
      <FieldLabel label={label} />
      <TextInput
        multiline
        numberOfLines={3}
        value={text(binding.value)}
        onChangeText={(next) => setValue(binding.name, next)}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          minHeight: 72,
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          color: theme.colors.foreground,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 13,
          textAlignVertical: "top",
        }}
      />
    </View>
  );
}

export function DateInput({ props }: { props: Props }) {
  return <Input props={{ ...props, placeholder: "YYYY-MM-DD" }} />;
}

export function Rating({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="Rating expects a $state binding" />;
  const max = Math.max(1, Math.min(10, Math.round(finiteNumber(props.max) ?? 5)));
  const current = Math.round(finiteNumber(binding.value) ?? 0);
  const label = optionalText(props.label);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} value={current > 0 ? `${current}/${max}` : undefined} />
      <View style={{ flexDirection: "row", gap: 6 }}>
        {Array.from({ length: max }, (_, idx) => {
          const star = idx + 1;
          const active = star <= current;
          return (
            <Pressable
              key={star}
              onPress={() => setValue(binding.name, star === current ? 0 : star)}
              accessibilityLabel={`${star} of ${max}`}
              style={{ padding: 3 }}
            >
              <Icon name="Star" size={18} color={active ? theme.colors.accent : theme.colors.foregroundMuted} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function OptionCards({ props }: { props: Props }) {
  const { theme, compact, setValue } = useUiRuntime();
  const feedback = useItemFeedback(`options:${propsKey(props.options)}`, { comments: props.comments === true, editable: false });
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="OptionCards expects a $state binding" />;
  const options = cardOptions(props.options);
  if (!options) return <ErrorLine message="OptionCards expects a list of options" />;
  const label = optionalText(props.label);
  const isMulti = Array.isArray(binding.value);
  const pickedList = isMulti ? (binding.value as readonly Value[]) : [];
  const allValues = options.map((o) => o.value);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} />
      <View style={{ flexDirection: compact ? "column" : "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt, idx) => {
          const selected = isMulti ? pickedList.includes(opt.value) : binding.value === opt.value;
          const iconName = opt.icon ? resolveIconName(opt.icon) ?? opt.icon : null;
          return (
            <View
              key={idx}
              style={{
                flex: compact ? undefined : 1,
                minWidth: 150,
                borderRadius: 10,
                borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                borderColor: selected ? theme.colors.foregroundMuted : theme.colors.border,
                backgroundColor: theme.colors.surface2,
                padding: 10,
                gap: 6,
              }}
            >
            <Pressable
              accessibilityRole={isMulti ? "checkbox" : "radio"}
              accessibilityState={{ checked: selected }}
              onPress={() => {
                if (isMulti) {
                  setValue(binding.name, togglePick(pickedList, opt.value, allValues));
                } else {
                  setValue(binding.name, opt.value);
                }
              }}
              style={{ gap: 6 }}
            >
              {opt.image ? <LoadedImageView src={opt.image} alt={opt.title} height={100} zoomable={false} /> : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {iconName ? <Icon name={iconName} size={15} color={theme.colors.accent} /> : null}
                <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>
                  {opt.title}
                </Text>
              </View>
              {opt.detail ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}><InlineMarkdown text={opt.detail} theme={theme} /></Text>
              ) : null}
            </Pressable>
            {feedback.controls(idx, `option "${opt.title}"`, {})}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Swatches({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  const parsed = swatchColors(props.colors, (c) => /^#([0-9a-f]{3,8})$|^(rgb|hsl|oklch|[a-z]+)$/i.test(c));
  if (!parsed) return <ErrorLine message="Swatches expects a list of colors" />;
  const label = optionalText(props.label);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {parsed.colors.map((swatch, idx) => {
          const active = binding ? sameColor(binding.value, swatch.value) : false;
          return (
            <Pressable
              key={idx}
              onPress={() => {
                if (binding) setValue(binding.name, swatch.value);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 8,
                paddingVertical: 5,
                borderRadius: 8,
                borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
                borderColor: active ? theme.colors.foregroundMuted : theme.colors.border,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: swatch.value,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: theme.colors.border,
                }}
              />
              <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                {swatch.name ?? swatch.value}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function EditableTable({ props }: { props: Props }) {
  const { theme, setValue } = useUiRuntime();
  const binding = isBinding(props.value) ? props.value : null;
  if (!binding) return <ErrorLine message="EditableTable expects a $state binding" />;
  const rows = tableRows(binding.value);
  if (rows === null) return <ErrorLine message="EditableTable state must be a list of objects" />;
  const columns = tableColumns(props.columns, rows);
  const label = optionalText(props.label);

  return (
    <View style={{ gap: 6 }}>
      <FieldLabel label={label} />
      <ScrollView horizontal>
        <View
          style={{
            borderRadius: 8,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
            overflow: "hidden",
            minWidth: "100%",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              backgroundColor: theme.colors.surface2,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.border,
            }}
          >
            {columns.map((col) => (
              <View key={col.key} style={{ width: 130, paddingHorizontal: 8, paddingVertical: 6 }}>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
                  {col.label}
                </Text>
              </View>
            ))}
            <View style={{ width: 36 }} />
          </View>
          {rows.map((row, rIdx) => (
            <View
              key={rIdx}
              style={{
                flexDirection: "row",
                alignItems: "center",
                borderTopWidth: rIdx === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: theme.colors.border,
              }}
            >
              {columns.map((col) => {
                const cellVal = row[col.key] ?? null;
                if (col.type === "boolean") {
                  return (
                    <Pressable
                      key={col.key}
                      onPress={() => setValue(binding.name, setCell(rows, rIdx, col.key, !cellVal))}
                      style={{ width: 130, paddingHorizontal: 8, paddingVertical: 6 }}
                    >
                      <CheckBox checked={Boolean(cellVal)} />
                    </Pressable>
                  );
                }
                return (
                  <View key={col.key} style={{ width: 130, paddingHorizontal: 6, paddingVertical: 4 }}>
                    <TextInput
                      defaultValue={cellVal === null ? "" : String(cellVal)}
                      onChangeText={(txt) => {
                        if (col.type === "number") {
                          const parsed = parseNumberInput(txt);
                          if (parsed !== undefined) {
                            setValue(binding.name, setCell(rows, rIdx, col.key, parsed));
                          }
                        } else {
                          setValue(binding.name, setCell(rows, rIdx, col.key, txt));
                        }
                      }}
                      style={{
                        color: theme.colors.foreground,
                        fontSize: 12.5,
                        paddingHorizontal: 6,
                        paddingVertical: 4,
                        borderRadius: 4,
                        backgroundColor: theme.colors.surface2,
                      }}
                    />
                  </View>
                );
              })}
              <Pressable
                onPress={() => setValue(binding.name, rows.filter((_, i) => i !== rIdx))}
                style={{ width: 36, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="Trash2" size={13} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      </ScrollView>
      <Pressable
        onPress={() => setValue(binding.name, [...rows, blankRow(columns)])}
        style={{
          alignSelf: "flex-start",
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 6,
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>+ Add row</Text>
      </Pressable>
    </View>
  );
}

export function Button({ props }: { props: Props }) {
  const { theme, run, queued } = useUiRuntime();
  const label = text(props.label);
  const variant = text(props.variant) || "secondary";
  const rawIcon = optionalText(props.icon);
  const iconName = rawIcon ? resolveIconName(rawIcon) ?? rawIcon : null;
  const actions: Action[] = Array.isArray(props.action)
    ? props.action.filter(isAction)
    : isAction(props.action)
      ? [props.action]
      : [{ kind: "action", type: "send", text: label }];
  // A button whose actions only queue shows as pressed while its text is in the reply.
  const queueTexts = actions.flatMap((action) => (action.type === "queue" ? [action.text] : []));
  const isQueued = queueTexts.length > 0 && queueTexts.every((t) => queued(`queue:${t}`) !== null);

  const bg =
    variant === "primary"
      ? theme.colors.accent
      : variant === "destructive"
        ? theme.colors.statusDanger
        : theme.colors.surface2;
  const fg =
    variant === "primary" || variant === "destructive"
      ? theme.colors.accentForeground
      : theme.colors.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isQueued }}
      onPress={() => void run(actions)}
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        backgroundColor: bg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: variant === "secondary" ? theme.colors.border : bg,
      }}
    >
      {isQueued ? <Icon name="Check" size={14} color={fg} /> : iconName ? <Icon name={iconName} size={14} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 12.5, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function ButtonGroup({ buttons }: { buttons: readonly GroupedButton[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      {buttons.map((b) => (
        <React.Fragment key={b.key}>{b.element}</React.Fragment>
      ))}
    </View>
  );
}

export function Form({ props }: { props: Props }) {
  const { theme, run, answer } = useUiRuntime();
  const children = nodes(props.children);
  const submitLabel = optionalText(props.submit) ?? "Submit";
  const formNode: UiNode = { kind: "node", type: "Form", key: "form", props };

  return (
    <View style={{ gap: 10 }}>
      <RenderNodes nodes={children} />
      {answer ? (
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 6,
            backgroundColor: theme.colors.surface2,
          }}
        >
          <Text style={{ color: theme.colors.statusSuccess, fontSize: 12 }}>Submitted</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const msg = formMessage(formNode);
            if (msg.trim() !== "") {
              void run([{ kind: "action", type: "send", text: msg }]);
            }
          }}
          style={{
            alignSelf: "flex-start",
            paddingHorizontal: 14,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: theme.colors.accent,
          }}
        >
          <Text style={{ color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" }}>
            {submitLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

export function FollowUps({ props }: { props: Props }) {
  const { theme, run } = useUiRuntime();
  const prompts = followUpPrompts(props.prompts);

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {prompts.map((prompt, idx) => (
        <Pressable
          key={idx}
          accessibilityRole="button"
          onPress={() => void run([{ kind: "action", type: "send", text: prompt }])}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: theme.colors.surface2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.colors.border,
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>{prompt}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A real checkbox: the box alone shows the state, so rows around it keep neutral borders. */
export function CheckBox({ checked }: { checked: boolean }) {
  const { theme } = useUiRuntime();
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: checked ? theme.colors.accent : theme.colors.foregroundMuted,
        backgroundColor: checked ? theme.colors.accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked ? <Icon name="Check" size={11} color={theme.colors.accentForeground} /> : null}
    </View>
  );
}
