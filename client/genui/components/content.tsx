// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { Icon as PaseoIcon, Modal, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { ImageLightbox } from "./image-lightbox";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import React, { useContext, useEffect, useState } from "react";
import { Image as RNImage, Platform, Pressable, StyleSheet, Text as RNText, View } from "react-native";
import { keyValuePairs } from "../../../shared/genui/logic/content-model";
import { parseListRows } from "../../../shared/genui/logic/explain-logic";
import { resolveIconName } from "../../../shared/genui/logic/icons";
import { entityKind, imageRef, inlineFacts, sourceLinks } from "../../../shared/genui/logic/references-model";
import { finiteNumber, isNode, list, optionalText, text, tone, type Props } from "../../../shared/genui/logic/values";
import { InlineMarkdown, MarkdownText } from "../markdown";
import { ErrorLine, RenderNode } from "../node-renderer";
import { InTableContext, propsKey, toneColor, toneMutedColor, useUiRuntime, type ImageUrl } from "../runtime";
import { useItemFeedback } from "./feedback";

export function Text({ props }: { props: Props }) {
  const { theme, compact } = useUiRuntime();
  const content = text(props.text);
  const t = tone(props.tone);
  const color = t === "neutral" ? theme.colors.foreground : toneColor(theme, t);
  return <MarkdownText text={content} theme={theme} compact={compact} color={color} />;
}

export function Callout({ props }: { props: Props }) {
  const { theme, compact } = useUiRuntime();
  const body = text(props.text);
  const title = optionalText(props.title);
  const t = tone(props.tone);

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        paddingHorizontal: 12,
        paddingVertical: 10,
        flexDirection: "row",
        gap: 8,
      }}
    >
      {t === "neutral" ? null : (
        <View style={{ paddingTop: 2 }}>
          <PaseoIcon name={CALLOUT_ICONS[t]} size={14} color={toneColor(theme, t)} />
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        {title ? (
          <RNText style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
            {title}
          </RNText>
        ) : null}
        <MarkdownText text={body} theme={theme} compact={compact} />
      </View>
    </View>
  );
}

const CALLOUT_ICONS = { good: "CircleCheck", warn: "AlertTriangle", bad: "CircleX", info: "Info" } as const;

export function Draft({ props }: { props: Props }) {
  const { theme, compact } = useUiRuntime();
  const toast = useToast();
  const [source, setSource] = useState(false);
  const body = text(props.markdown);
  const title = optionalText(props.title);
  const action = (label: string, onPress: () => void, active = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
      <RNText style={{ color: active ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 11.5, fontWeight: "500" }}>
        {label}
      </RNText>
    </Pressable>
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
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
        }}
      >
        <RNText numberOfLines={1} style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 11.5 }}>
          {title ?? "Draft"}
        </RNText>
        {action("Source", () => setSource((value) => !value), source)}
        {action("Copy", () => {
          void copyText(body).then(
            () => toast.show("Copied", { variant: "success" }),
            () => toast.error("Could not copy"),
          );
        })}
      </View>
      <View style={{ padding: 10 }}>
        {source ? (
          <RNText selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12, lineHeight: 18 }}>
            {body}
          </RNText>
        ) : (
          <MarkdownText text={body} theme={theme} compact={compact} />
        )}
      </View>
    </View>
  );
}

export function Metric({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const label = text(props.label);
  const value = text(props.value);
  const note = optionalText(props.note);
  const t = tone(props.tone);

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 2,
      }}
    >
      <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>{label}</RNText>
      <RNText
        selectable
        style={{
          color: toneColor(theme, t),
          fontSize: 20,
          fontWeight: "700",
        }}
      >
        {value}
      </RNText>
      {note ? (
        <RNText style={{ color: toneMutedColor(theme, t), fontSize: 11.5 }}>{note}</RNText>
      ) : null}
    </View>
  );
}

export function Badge({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const inTable = useContext(InTableContext);
  const label = text(props.text);
  const t = tone(props.tone);
  const color = t === "neutral" ? theme.colors.foregroundMuted : toneColor(theme, t);

  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: inTable ? 6 : 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: theme.colors.surface2,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: t === "neutral" ? theme.colors.border : color,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <RNText style={{ color, fontSize: 11.5, fontWeight: "500" }}>{label}</RNText>
    </View>
  );
}

export function Icon({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const rawName = text(props.name);
  const resolved = resolveIconName(rawName) ?? rawName;
  const t = tone(props.tone);
  return <PaseoIcon name={resolved} size={16} color={toneColor(theme, t)} />;
}

export function KeyValue({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const pairs = keyValuePairs(props.pairs);
  if (pairs === null) return <ErrorLine message="KeyValue expects an object or [[key, value]] list" />;

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      {pairs.map(([k, v], idx) => (
        <View
          key={`${k}:${idx}`}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
          }}
        >
          <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12.5, flexShrink: 0 }}>
            {k}
          </RNText>
          {isNode(v) ? (
            <RenderNode node={v} />
          ) : (
            <RNText
              selectable
              style={{ color: theme.colors.foreground, fontSize: 12.5, flex: 1, textAlign: "right" }}
            >
              {text(v)}
            </RNText>
          )}
        </View>
      ))}
    </View>
  );
}

export function LoadedImageView({
  src,
  alt,
  height = 200,
  zoomable = true,
}: {
  src: string;
  alt?: string | null;
  height?: number;
  /** Tapping opens the image full size; off where the image sits inside another tap target. */
  zoomable?: boolean;
}) {
  const { theme, loadImage } = useUiRuntime();
  const [state, setState] = useState<ImageUrl | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!loadImage || !src) return;
    let live = true;
    void loadImage(src).then((res) => {
      if (live) setState(res);
    });
    return () => {
      live = false;
    };
  }, [loadImage, src]);

  if (!src) return <ErrorLine message="Image src is empty" />;
  if (state === null) {
    return (
      <View
        style={{
          height,
          borderRadius: 8,
          backgroundColor: theme.colors.surface2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading image…</RNText>
      </View>
    );
  }
  if (!state.ok) {
    return (
      <View
        style={{
          borderRadius: 8,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          padding: 10,
        }}
      >
        <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          {state.error} ({src})
        </RNText>
      </View>
    );
  }

  const picture = (frameHeight: number) => (
    <RNImage
      source={{ uri: state.url }}
      accessibilityLabel={alt ?? src}
      resizeMode="contain"
      style={{
        width: "100%",
        height: frameHeight,
        borderRadius: 8,
        backgroundColor: theme.colors.surface2,
      }}
    />
  );

  return (
    <View style={{ gap: 4 }}>
      {zoomable ? (
        <Pressable accessibilityRole="imagebutton" accessibilityLabel={`View ${alt ?? src} full size`} onPress={() => setZoomed(true)}>
          {picture(height)}
        </Pressable>
      ) : (
        picture(height)
      )}
      {alt ? (
        <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 11.5 }}>{alt}</RNText>
      ) : null}
      {zoomed ? <ImageLightbox uri={state.url} title={alt ?? src} onClose={() => setZoomed(false)} /> : null}
    </View>
  );
}

export function Image({ props }: { props: Props }) {
  const src = text(props.src);
  const alt = optionalText(props.alt);
  return <LoadedImageView src={src} alt={alt} height={220} />;
}

export function File({ props }: { props: Props }) {
  const { theme, readText } = useUiRuntime();
  const filePath = text(props.path);
  const line = finiteNumber(props.line);
  const label = line !== null ? `${filePath}:${Math.round(line)}` : filePath;
  const [opened, setOpened] = useState(false);
  const [result, setResult] = useState<{ ok: true; text: string } | { ok: false; error: string } | null>(null);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    setResult(null);
    const timer = setTimeout(() => {
      if (active) { active = false; setResult({ ok: false, error: "Время ожидания файла истекло" }); }
    }, 15000);
    Promise.resolve().then(() => readText ? readText(filePath) : { ok: false as const, error: "Просмотр файлов недоступен" }).then(
      value => { if (active) { clearTimeout(timer); setResult(value); } },
      error => { if (active) { clearTimeout(timer); setResult({ ok: false, error: String(error) }); } },
    );
    return () => { active = false; clearTimeout(timer); };
  }, [opened, filePath, readText]);
  // Stay in the chat on every platform. History routing can open a blank host pane,
  // particularly for paths outside the workspace. The reader enforces file access.
  return (
    <View style={{ gap: 8 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpened(value => !value)}
        style={{ alignSelf: "flex-start", padding: 8, borderRadius: 6, backgroundColor: theme.colors.surface2 }}>
        <RNText style={{ color: theme.colors.accent, fontSize: 12 }}>{label}</RNText>
      </Pressable>
      {opened ? <View style={{ gap: 8, padding: 10, backgroundColor: theme.colors.surface2, borderRadius: 6 }}>
        <Pressable accessibilityRole="button" onPress={() => setOpened(false)}>
          <RNText style={{ color: theme.colors.accent }}>Закрыть файл</RNText>
        </Pressable>
        {result === null ? <RNText style={{ color: theme.colors.foregroundMuted }}>Загрузка файла...</RNText>
          : result.ok ? <RNText selectable style={{ color: theme.colors.foreground, fontFamily: "monospace", fontSize: 12 }}>{result.text}</RNText>
          : <RNText style={{ color: theme.colors.statusDanger }}>{result.error}</RNText>}
      </View> : null}
    </View>
  );
}

export function Entity({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const [open, setOpen] = useState(false);
  const name = text(props.name);
  const kind = entityKind(props.kind);
  const note = optionalText(props.note);
  const url = optionalText(props.url);
  const imgRef = imageRef(text(props.image));
  const rawPairs = keyValuePairs(props.facts) ?? [];
  const previewFacts = inlineFacts(rawPairs, 4);

  return (
    <View
      style={{
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        padding: 12,
        gap: 8,
      }}
    >
      {imgRef.kind === "load" ? <LoadedImageView src={imgRef.src} alt={name} height={140} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <RNText selectable style={{ color: theme.colors.foreground, fontSize: 14, fontWeight: "600", flex: 1 }}>
          {name}
        </RNText>
        <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 11, textTransform: "uppercase" }}>
          {kind}
        </RNText>
      </View>
      {note ? <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12.5 }}>{note}</RNText> : null}
      {previewFacts.length > 0 ? (
        <View style={{ gap: 4 }}>
          {previewFacts.map((fact, idx) => (
            <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{fact.label}</RNText>
              <RNText selectable style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "500" }}>
                {fact.value}
              </RNText>
            </View>
          ))}
          {rawPairs.length > 4 ? (
            <Pressable onPress={() => setOpen(true)}>
              <RNText style={{ color: theme.colors.accent, fontSize: 12 }}>
                View all {rawPairs.length} facts
              </RNText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {url && /^https?:\/\//i.test(url) ? (
        <ExternalLink href={url}>
          <RNText style={{ color: theme.colors.accent, fontSize: 12 }}>{url}</RNText>
        </ExternalLink>
      ) : null}
      {open ? (
        <Modal title={name} open={open} onOpenChange={setOpen}>
          <Modal.Content>
            <View style={{ gap: 8 }}>
              {rawPairs.map(([label, val], idx) => (
                <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>{label}</RNText>
                  <RNText selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>
                    {text(val)}
                  </RNText>
                </View>
              ))}
            </View>
          </Modal.Content>
        </Modal>
      ) : null}
    </View>
  );
}

export function Sources({ props }: { props: Props }) {
  const { theme } = useUiRuntime();
  const links = sourceLinks(list(props.links));

  return (
    <View style={{ gap: 6 }}>
      {links.map((item, idx) =>
        item.ok ? (
          <View
            key={`${item.href}:${idx}`}
            style={{
              borderRadius: 8,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface2,
              paddingHorizontal: 10,
              paddingVertical: 8,
              gap: 2,
            }}
          >
            <ExternalLink href={item.href}>
              <RNText style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "500" }}>
                [{item.number}] {item.title}
              </RNText>
            </ExternalLink>
            <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{item.domain}</RNText>
            {item.note ? (
              <RNText style={{ color: theme.colors.foreground, fontSize: 12 }}>{item.note}</RNText>
            ) : null}
          </View>
        ) : (
          <ErrorLine key={idx} message={item.error} />
        ),
      )}
    </View>
  );
}

export function List({ props }: { props: Props }) {
  const { theme, run } = useUiRuntime();
  const rows = parseListRows(props.items);
  const feedback = useItemFeedback(`list:${propsKey(props.items)}`, {
    comments: props.comments === true,
    editable: props.editable === true,
  });

  return (
    <View
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      {rows.map((item, idx) => {
        const iconName = item.icon ? resolveIconName(item.icon) ?? item.icon : null;
        const t = item.tone ?? "neutral";
        const original = { title: item.title, detail: item.detail ?? "" };
        const shown = feedback.fields(idx, original);
        const controls = feedback.controls(idx, `"${item.title}"`, original);
        const rowContent = (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              paddingHorizontal: 12,
              paddingVertical: 9,
              borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              {iconName ? (
                <PaseoIcon name={iconName} size={15} color={toneColor(theme, t)} />
              ) : null}
              <View style={{ flex: 1, gap: 2 }}>
                <RNText style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "500" }}>
                  {shown.title}
                </RNText>
                {shown.detail ? (
                  <RNText style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    <InlineMarkdown text={shown.detail} theme={theme} />
                  </RNText>
                ) : null}
              </View>
            </View>
            {item.value !== null ? (
              isNode(item.value) ? (
                <RenderNode node={item.value} />
              ) : (
                <RNText style={{ color: toneColor(theme, t), fontSize: 12.5, fontWeight: "500" }}>
                  {text(item.value)}
                </RNText>
              )
            ) : null}
          </View>
        );
        return (
          <View key={idx}>
            {item.actions.length > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => void run(item.actions)}>
                {rowContent}
              </Pressable>
            ) : (
              rowContent
            )}
            {controls ? <View style={{ paddingHorizontal: 12, paddingBottom: 9 }}>{controls}</View> : null}
          </View>
        );
      })}
    </View>
  );
}
