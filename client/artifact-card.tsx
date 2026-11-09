import { useState, useCallback, useEffect } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Platform, Linking } from "react-native";
import { Icon, useToast, Markdown } from "@getpaseo/plugin/client/ui";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import {
  artifactSaveRpc,
  artifactUploadYadiskRpc,
  artifactSendTelegramRpc,
  type ArtifactKind,
} from "../shared/artifacts-contracts";
import { utf8ByteLength } from "./artifacts-segment";

export const isWeb = Platform.OS === "web";
const SafeIframe = isWeb ? ("iframe" as any) : null;

export function openExternalUrl(url: string) {
  if (isWeb && typeof window !== "undefined") {
    window.open(url, "_blank");
  } else {
    void Linking.openURL(url).catch((err) => {
      console.warn("[artifacts] Failed opening URL on mobile:", err);
    });
  }
}

export interface ArtifactCardData {
  name: string;
  title: string;
  kind: ArtifactKind;
  code: string;
  complete?: boolean;
  fenceIndex?: number;
  size?: number;
  messageId?: string;
  projectId?: string;
  projectDisplayName?: string;
  artifactId?: string;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function createArtifactBlob(content: string, mimeType: string): Blob {
  if (content.startsWith("data:")) {
    const comma = content.indexOf(",");
    const header = content.slice(0, comma);
    const dataPart = content.slice(comma + 1);
    const detectedMime = /^data:([^;,]+)/.exec(header)?.[1] || mimeType;
    if (header.includes(";base64")) {
      const byteChars = atob(dataPart);
      const byteNumbers = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      return new Blob([byteNumbers], { type: detectedMime });
    }
    return new Blob([decodeURIComponent(dataPart)], { type: detectedMime });
  }
  return new Blob([content], { type: mimeType });
}

export function downloadInBrowser(content: string, filename: string, mimeType: string) {
  if (typeof document === "undefined") return;
  const blob = createArtifactBlob(content, mimeType);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function openInNewTab(content: string, mimeType: string) {
  if (!isWeb || typeof window === "undefined") return;
  const blob = createArtifactBlob(content, mimeType);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

export function ArtifactCard({
  item,
  theme,
  agentId,
  timestamp,
}: PluginTimelineItemProps<ArtifactCardData>) {
  const c = theme.colors;
  const toast = useToast();
  const saveRpc = useRpc(artifactSaveRpc);
  const uploadYadiskRpc = useRpc(artifactUploadYadiskRpc);
  const sendTelegramRpc = useRpc(artifactSendTelegramRpc);

  const { name, title, kind, code, size } = item.data;
  const [previewOpen, setPreviewOpen] = useState(isWeb && (kind === "html" || kind === "svg"));
  const [tallPreview, setTallPreview] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sendingTg, setSendingTg] = useState(false);
  const [yadiskLink, setYadiskLink] = useState<string | null>(null);
  const [persistedId, setPersistedId] = useState<string | null>(item.data.artifactId ?? null);

  // Автоматическое сохранение в центральное хранилище артефактов (только для свежесозданных сообщений!)
  useEffect(() => {
    if (item.data.complete === false) return;
    if (persistedId) return;

    // Не автосохраняем старые сообщения из истории (старше 2 минут)
    // чтобы при открытии старых чатов они не воскрешались в галерее
    const msgAge = timestamp ? Date.now() - new Date(timestamp).getTime() : 0;
    if (msgAge > 120_000) return;

    let mounted = true;
    void saveRpc({
      name,
      title,
      kind,
      content: code,
      agentId,
      sourceType: "chat_code",
    })
      .then((res) => {
        if (mounted && res?.artifact?.id) {
          if (!res.artifact.id.startsWith("deleted_")) {
            setPersistedId(res.artifact.id);
            if (res.artifact.yadiskUrl) {
              setYadiskLink(res.artifact.yadiskUrl);
            }
          }
        }
      })
      .catch((err) => {
        console.warn("[artifacts] Failed auto-saving artifact to server store:", err);
      });

    return () => {
      mounted = false;
    };
  }, [name, title, kind, code, agentId, persistedId, saveRpc, item.data.complete, timestamp]);

  const mimeType =
    kind === "html"
      ? "text/html;charset=utf-8"
      : kind === "svg"
      ? "image/svg+xml;charset=utf-8"
      : kind === "file" && code.startsWith("data:application/pdf")
      ? "application/pdf"
      : "text/plain;charset=utf-8";

  const handleDownload = useCallback(() => {
    downloadInBrowser(code, name, mimeType);
    toast.show(`Скачивание ${name}`, { variant: "success" });
  }, [code, name, mimeType, toast]);

  const handleOpenTab = useCallback(() => {
    openInNewTab(code, mimeType);
  }, [code, mimeType]);

  const handleSendTelegram = useCallback(async () => {
    setSendingTg(true);
    try {
      let targetId = persistedId;
      if (!targetId) {
        const saved = await saveRpc({
          name,
          title,
          kind,
          content: code,
          agentId,
          sourceType: "chat_code",
        });
        targetId = saved.artifact.id;
        setPersistedId(targetId);
      }

      const res = await sendTelegramRpc({ id: targetId });
      if (res.ok) {
        toast.show("Отправлено в Telegram!", { variant: "success" });
      } else {
        toast.error(`Ошибка Telegram: ${res.error ?? "Не удалось отправить"}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Ошибка: ${msg}`);
    } finally {
      setSendingTg(false);
    }
  }, [persistedId, saveRpc, sendTelegramRpc, name, title, kind, code, agentId, toast]);

  const handleUploadYadisk = useCallback(async () => {
    if (yadiskLink) {
      openExternalUrl(yadiskLink);
      return;
    }

    setUploading(true);
    try {
      let targetId = persistedId;
      if (!targetId) {
        const saved = await saveRpc({
          name,
          title,
          kind,
          content: code,
          agentId,
          sourceType: "chat_code",
        });
        targetId = saved.artifact.id;
        setPersistedId(targetId);
      }

      const res = await uploadYadiskRpc({ id: targetId });
      if (res.ok && res.yadiskUrl) {
        setYadiskLink(res.yadiskUrl);
        toast.show("Выгружено в облако!", { variant: "success" });
        openExternalUrl(res.yadiskUrl);
      } else if (res.ok) {
        toast.show("Файл скопирован в облако", { variant: "info" });
      } else {
        toast.error(`Ошибка Диска: ${res.error ?? "Неизвестная ошибка"}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Ошибка: ${msg}`);
    } finally {
      setUploading(false);
    }
  }, [yadiskLink, persistedId, saveRpc, uploadYadiskRpc, name, title, kind, code, agentId, toast]);

  const kindBadgeColor =
    kind === "html"
      ? "#f97316"
      : kind === "svg"
      ? "#a855f7"
      : kind === "markdown"
      ? "#3b82f6"
      : "#10b981";

  const kindIcon = kind === "html" ? "FileCode" : kind === "svg" ? "Image" : "FileText";
  const byteSize = size || utf8ByteLength(code);

  return (
    <View
      style={{
        marginVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        overflow: "hidden",
      }}
    >
      {/* Шапка карточки артефакта */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: c.surface2,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 200 }}>
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              backgroundColor: `${kindBadgeColor}15`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={kindIcon} size={16} color={kindBadgeColor} />
          </View>

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Text
                numberOfLines={1}
                style={{
                  color: c.foreground,
                  fontSize: 13.5,
                  fontWeight: "600",
                }}
              >
                {title || name}
              </Text>

              {/* Бейджик типа */}
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1.5,
                  borderRadius: 4,
                  backgroundColor: `${kindBadgeColor}20`,
                }}
              >
                <Text
                  style={{
                    color: kindBadgeColor,
                    fontSize: 10.5,
                    fontWeight: "700",
                    textTransform: "uppercase",
                  }}
                >
                  {kind}
                </Text>
              </View>

              {/* Бейджик проекта (если есть) */}
              {item.data.projectDisplayName ? (
                <View
                  style={{
                    paddingHorizontal: 6,
                    paddingVertical: 1.5,
                    borderRadius: 4,
                    backgroundColor: c.surface1,
                    borderWidth: 1,
                    borderColor: c.border,
                  }}
                >
                  <Text
                    style={{
                      color: c.foregroundMuted,
                      fontSize: 10.5,
                      fontWeight: "500",
                    }}
                  >
                    {item.data.projectDisplayName}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text
              style={{
                color: c.foregroundMuted,
                fontSize: 11,
                marginTop: 1,
              }}
            >
              {name} • {formatBytes(byteSize)}
            </Text>
          </View>
        </View>
      </View>

      {/* Панель действий */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          flexWrap: "wrap",
        }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => setPreviewOpen((v) => !v)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 7,
            backgroundColor: isWeb ? c.accent : c.surface2,
            borderWidth: isWeb ? 0 : 1,
            borderColor: isWeb ? "transparent" : c.border,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Icon name={previewOpen ? "EyeOff" : "Eye"} size={13} color={isWeb ? "#fff" : c.foreground} />
          <Text style={{ color: isWeb ? "#fff" : c.foreground, fontSize: 12, fontWeight: isWeb ? "600" : "500" }}>
            {previewOpen ? "Скрыть код" : "Просмотр кода"}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => void handleSendTelegram()}
          disabled={sendingTg}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 7,
            backgroundColor: c.surface2,
            borderWidth: 1,
            borderColor: c.border,
            opacity: pressed || sendingTg ? 0.75 : 1,
          })}
        >
          <Icon name="Send" size={13} color={c.foreground} />
          <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "500" }}>
            {sendingTg ? "Отправка..." : "В Telegram"}
          </Text>
        </Pressable>

        {isWeb && (kind === "html" || kind === "svg" || (kind === "file" && code.startsWith("data:application/pdf"))) ? (
          <Pressable
            accessibilityRole="button"
            onPress={handleOpenTab}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 7,
              backgroundColor: c.surface2,
              borderWidth: 1,
              borderColor: c.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Icon name="ExternalLink" size={13} color={c.foreground} />
            <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "500" }}>
              В новой вкладке
            </Text>
          </Pressable>
        ) : null}

        {isWeb ? (
          <Pressable
            accessibilityRole="button"
            onPress={handleDownload}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 7,
              backgroundColor: c.surface2,
              borderWidth: 1,
              borderColor: c.border,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Icon name="Download" size={13} color={c.foreground} />
            <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "500" }}>Скачать</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => void handleUploadYadisk()}
          disabled={uploading}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 7,
            backgroundColor: yadiskLink ? "#e0f2fe" : c.surface2,
            borderWidth: 1,
            borderColor: yadiskLink ? "#38bdf8" : c.border,
            opacity: pressed || uploading ? 0.7 : 1,
          })}
        >
          <Icon name="Cloud" size={13} color={yadiskLink ? "#0284c7" : c.foregroundMuted} />
          <Text
            style={{
              color: yadiskLink ? "#0369a1" : c.foregroundMuted,
              fontSize: 12,
              fontWeight: "500",
            }}
          >
            {uploading ? "Выгрузка..." : yadiskLink ? "В облаке (открыть)" : "В облако"}
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          {previewOpen ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setTallPreview((v) => !v)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 6,
                borderRadius: 7,
                backgroundColor: "transparent",
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon name={tallPreview ? "Minimize2" : "Maximize2"} size={13} color={c.foregroundMuted} />
              <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
                {tallPreview ? "Обычная высота" : "Развернуть выше"}
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => setCodeOpen((v) => !v)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 6,
              borderRadius: 7,
              backgroundColor: "transparent",
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon name={codeOpen ? "ChevronUp" : "Code"} size={13} color={c.foregroundMuted} />
            <Text style={{ color: c.foregroundMuted, fontSize: 11.5 }}>
              {codeOpen ? "Скрыть код" : "Исходный код"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Встроенное широкое окно предпросмотра прямо в карточке */}
      {previewOpen ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.border,
            width: "100%",
            height: tallPreview ? 720 : 440,
            backgroundColor: kind === "markdown" || !isWeb ? c.surface0 : "#ffffff",
          }}
        >
          {kind === "markdown" ? (
            <ScrollView style={{ flex: 1, padding: 18 }}>
              <Markdown>{code}</Markdown>
            </ScrollView>
          ) : !isWeb ? (
            <ScrollView style={{ flex: 1, padding: 16 }}>
              <View
                style={{
                  padding: 10,
                  marginBottom: 10,
                  borderRadius: 8,
                  backgroundColor: c.surface2,
                  borderWidth: 1,
                  borderColor: c.border,
                }}
              >
                <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                  Интерактивное превью доступно на компьютере. Ниже отображен исходный код.
                </Text>
              </View>
              <Markdown>{`\`\`\`${kind}\n${code}\n\`\`\``}</Markdown>
            </ScrollView>
          ) : kind === "file" && code.startsWith("data:application/pdf") ? (
            SafeIframe ? (
              <SafeIframe
                src={code}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                }}
              />
            ) : null
          ) : (
            SafeIframe ? (
              <SafeIframe
                srcDoc={code}
                sandbox="allow-scripts"
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  backgroundColor: "#ffffff",
                }}
              />
            ) : null
          )}
        </View>
      ) : null}

      {/* Спойлер с исходным кодом */}
      {codeOpen ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.border,
            padding: 12,
            backgroundColor: c.surface2,
            maxHeight: 340,
          }}
        >
          <ScrollView style={{ flex: 1 }}>
            <Markdown>{`\`\`\`${kind}\n${code}\n\`\`\``}</Markdown>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}
