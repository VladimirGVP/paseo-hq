import { useState, useCallback, useEffect, useMemo } from "react";
import { View, Text, Pressable, TextInput, ScrollView } from "react-native";
import { Icon, useToast, Markdown } from "@getpaseo/plugin/client/ui";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  artifactsListRpc,
  artifactReadRpc,
  artifactUploadYadiskRpc,
  artifactSendTelegramRpc,
  artifactDeleteRpc,
  type StoredArtifact,
  type ArtifactKind,
} from "../shared/artifacts-contracts";
import {
  formatBytes,
  downloadInBrowser,
  openInNewTab,
  openExternalUrl,
  isWeb,
} from "./artifact-card";

const SafeIframe = isWeb ? ("iframe" as any) : null;

export function ArtifactsSurface({ theme, layout }: PluginSurfaceProps) {
  const c = theme.colors;
  const toast = useToast();
  const listRpc = useRpc(artifactsListRpc);
  const readRpc = useRpc(artifactReadRpc);
  const uploadYadiskRpc = useRpc(artifactUploadYadiskRpc);
  const sendTelegramRpc = useRpc(artifactSendTelegramRpc);
  const deleteRpc = useRpc(artifactDeleteRpc);

  const [artifacts, setArtifacts] = useState<StoredArtifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedKind, setSelectedKind] = useState<ArtifactKind | "all">("all");
  const [selectedProject, setSelectedProject] = useState<string>("all");

  const [previewArtifact, setPreviewArtifact] = useState<StoredArtifact | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [uploadingYadisk, setUploadingYadisk] = useState(false);
  const [sendingTg, setSendingTg] = useState(false);
  const [showSourceCode, setShowSourceCode] = useState(false);

  const reloadArtifacts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await listRpc({ limit: 200 });
      setArtifacts(res.artifacts ?? []);
    } catch {
      // Игнорируем временные сетевые сбои
    } finally {
      setLoading(false);
    }
  }, [listRpc]);

  useEffect(() => {
    void reloadArtifacts();
  }, [reloadArtifacts]);

  const filtered = useMemo(() => {
    return artifacts.filter((a) => {
      if (selectedKind !== "all" && a.kind !== selectedKind) return false;
      if (selectedProject !== "all" && a.projectId !== selectedProject) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesTitle = a.title.toLowerCase().includes(q);
        const matchesProj = (a.projectDisplayName || a.projectId || "").toLowerCase().includes(q);
        return matchesName || matchesTitle || matchesProj;
      }
      return true;
    });
  }, [artifacts, selectedKind, selectedProject, search]);

  const handleOpen = useCallback(
    async (art: StoredArtifact) => {
      setPreviewArtifact(art);
      setPreviewContent(null);
      setShowSourceCode(false);
      setContentLoading(true);
      try {
        const res = await readRpc({ id: art.id });
        setPreviewContent(res.content);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Не удалось прочитать артефакт: ${msg}`);
      } finally {
        setContentLoading(false);
      }
    },
    [readRpc, toast],
  );

  const getMimeType = useCallback((art: StoredArtifact, content: string | null) => {
    if (art.kind === "html") return "text/html;charset=utf-8";
    if (art.kind === "svg") return "image/svg+xml;charset=utf-8";
    if (content?.startsWith("data:application/pdf") || art.name.toLowerCase().endsWith(".pdf")) {
      return "application/pdf";
    }
    return "text/plain;charset=utf-8";
  }, []);

  const handleDownload = useCallback(() => {
    if (!previewArtifact || !previewContent) return;
    const mime = getMimeType(previewArtifact, previewContent);
    downloadInBrowser(previewContent, previewArtifact.name, mime);
    toast.show(`Скачивание ${previewArtifact.name}`, { variant: "success" });
  }, [previewArtifact, previewContent, getMimeType, toast]);

  const handleOpenInTab = useCallback(() => {
    if (!previewArtifact || !previewContent) return;
    const mime = getMimeType(previewArtifact, previewContent);
    openInNewTab(previewContent, mime);
  }, [previewArtifact, previewContent, getMimeType]);

  const handleSendTelegram = useCallback(async () => {
    if (!previewArtifact) return;
    setSendingTg(true);
    try {
      const res = await sendTelegramRpc({ id: previewArtifact.id });
      if (res.ok) {
        toast.show("Отправлено ботом Энигма в Telegram!", { variant: "success" });
      } else {
        toast.error(`Ошибка Telegram: ${res.error ?? "Не удалось отправить"}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Ошибка: ${msg}`);
    } finally {
      setSendingTg(false);
    }
  }, [previewArtifact, sendTelegramRpc, toast]);

  const handleUploadYadisk = useCallback(async () => {
    if (!previewArtifact) return;
    if (previewArtifact.yadiskUrl) {
      openExternalUrl(previewArtifact.yadiskUrl);
      return;
    }

    setUploadingYadisk(true);
    try {
      const res = await uploadYadiskRpc({ id: previewArtifact.id });
      if (res.ok && res.yadiskUrl) {
        setPreviewArtifact((prev) => (prev ? { ...prev, yadiskUrl: res.yadiskUrl } : null));
        void reloadArtifacts();
        toast.show("Выгружено в облако!", { variant: "success" });
        openExternalUrl(res.yadiskUrl);
      } else {
        toast.error(`Ошибка: ${res.error ?? "Не удалось выгрузить"}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Ошибка: ${msg}`);
    } finally {
      setUploadingYadisk(false);
    }
  }, [previewArtifact, uploadYadiskRpc, reloadArtifacts, toast]);

  const handleDelete = useCallback(
    async (id: string, fromPreview = false) => {
      try {
        const res = await deleteRpc({ id });
        if (res.ok) {
          setArtifacts((prev) => prev.filter((a) => a.id !== id));
          if (fromPreview || previewArtifact?.id === id) {
            setPreviewArtifact(null);
            setPreviewContent(null);
            setShowSourceCode(false);
          }
          toast.show("Артефакт удален из панели", { variant: "success" });
        } else {
          toast.error("Не удалось удалить артефакт");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Ошибка удаления: ${msg}`);
      }
    },
    [deleteRpc, previewArtifact, toast],
  );

  // Полноэкранный широкий режим чтения и исследования выбранного артефакта
  if (previewArtifact) {
    const isPdf =
      Boolean(previewContent?.startsWith("data:application/pdf")) ||
      previewArtifact.name.toLowerCase().endsWith(".pdf");
    const kindColor =
      previewArtifact.kind === "html"
        ? "#f97316"
        : previewArtifact.kind === "svg"
        ? "#a855f7"
        : isPdf
        ? "#10b981"
        : "#3b82f6";

    return (
      <View
        style={{
          flex: 1,
          width: "100%",
          backgroundColor: c.surface0,
          padding: layout.compact ? 12 : 20,
          gap: 14,
        }}
      >
        {/* Верхняя широкоформатная панель управления */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
            backgroundColor: c.surface1,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          {/* Левая часть: Назад + Название + Проект + Размер */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              flex: 1,
              minWidth: 240,
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setPreviewArtifact(null);
                setPreviewContent(null);
                setShowSourceCode(false);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 8,
                backgroundColor: c.surface2,
                borderWidth: 1,
                borderColor: c.border,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Icon name="ArrowLeft" size={15} color={c.foreground} />
              <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>
                К списку
              </Text>
            </Pressable>

            <View style={{ flex: 1, minWidth: 160 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Text
                  style={{
                    color: c.foreground,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                >
                  {previewArtifact.title || previewArtifact.name}
                </Text>

                <View
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                    borderRadius: 5,
                    backgroundColor: `${kindColor}20`,
                  }}
                >
                  <Text
                    style={{
                      color: kindColor,
                      fontSize: 10.5,
                      fontWeight: "700",
                      textTransform: "uppercase",
                    }}
                  >
                    {isPdf ? "PDF" : previewArtifact.kind}
                  </Text>
                </View>

                {previewArtifact.projectDisplayName || previewArtifact.projectId ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 5,
                      backgroundColor: c.surface2,
                      borderWidth: 1,
                      borderColor: c.border,
                    }}
                  >
                    <Text style={{ color: c.foreground, fontSize: 11.5, fontWeight: "600" }}>
                      Проект: {previewArtifact.projectDisplayName || previewArtifact.projectId}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={{ color: c.foregroundMuted, fontSize: 12, marginTop: 2 }}>
                {previewArtifact.name} • {formatBytes(previewArtifact.size)}
              </Text>
            </View>
          </View>

          {/* Правая часть: Действия (Исходный код, В новой вкладке, Скачать, На Яндекс Диск) */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleSendTelegram()}
              disabled={sendingTg}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 8,
                backgroundColor: c.surface2,
                borderWidth: 1,
                borderColor: c.border,
                opacity: pressed || sendingTg ? 0.75 : 1,
              })}
            >
              <Icon name="Send" size={14} color={c.foreground} />
              <Text style={{ color: c.foreground, fontSize: 12.5, fontWeight: "500" }}>
                {sendingTg ? "Отправка..." : "В Telegram"}
              </Text>
            </Pressable>

            {!isPdf && isWeb ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowSourceCode((v) => !v)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: showSourceCode ? c.accent : c.surface2,
                  borderWidth: 1,
                  borderColor: showSourceCode ? c.accent : c.border,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Icon name="Code" size={14} color={showSourceCode ? "#ffffff" : c.foreground} />
                <Text
                  style={{
                    color: showSourceCode ? "#ffffff" : c.foreground,
                    fontSize: 12.5,
                    fontWeight: "500",
                  }}
                >
                  {showSourceCode ? "Режим чтения" : "Исходный код"}
                </Text>
              </Pressable>
            ) : null}

            {isWeb && (previewArtifact.kind === "html" || previewArtifact.kind === "svg" || isPdf) ? (
              <Pressable
                accessibilityRole="button"
                onPress={handleOpenInTab}
                disabled={!previewContent}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: c.surface2,
                  borderWidth: 1,
                  borderColor: c.border,
                  opacity: pressed || !previewContent ? 0.7 : 1,
                })}
              >
                <Icon name="ExternalLink" size={14} color={c.foreground} />
                <Text style={{ color: c.foreground, fontSize: 12.5, fontWeight: "500" }}>
                  В новой вкладке
                </Text>
              </Pressable>
            ) : null}

            {isWeb ? (
              <Pressable
                accessibilityRole="button"
                onPress={handleDownload}
                disabled={!previewContent}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 11,
                  paddingVertical: 7,
                  borderRadius: 8,
                  backgroundColor: c.surface2,
                  borderWidth: 1,
                  borderColor: c.border,
                  opacity: pressed || !previewContent ? 0.7 : 1,
                })}
              >
                <Icon name="Download" size={14} color={c.foreground} />
                <Text style={{ color: c.foreground, fontSize: 12.5, fontWeight: "500" }}>
                  Скачать
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => void handleUploadYadisk()}
              disabled={uploadingYadisk}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 8,
                backgroundColor: previewArtifact.yadiskUrl ? "#e0f2fe" : c.surface2,
                borderWidth: 1,
                borderColor: previewArtifact.yadiskUrl ? "#38bdf8" : c.border,
                opacity: pressed || uploadingYadisk ? 0.7 : 1,
              })}
            >
              <Icon
                name="Cloud"
                size={14}
                color={previewArtifact.yadiskUrl ? "#0284c7" : c.foreground}
              />
              <Text
                style={{
                  color: previewArtifact.yadiskUrl ? "#0369a1" : c.foreground,
                  fontSize: 12.5,
                  fontWeight: "600",
                }}
              >
                {uploadingYadisk
                  ? "Выгрузка..."
                  : previewArtifact.yadiskUrl
                  ? "Открыть в облаке"
                  : "В облако"}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => void handleDelete(previewArtifact.id, true)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 8,
                backgroundColor: c.surface2,
                borderWidth: 1,
                borderColor: "#ef444450",
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Icon name="Trash2" size={14} color="#ef4444" />
              <Text style={{ color: "#ef4444", fontSize: 12.5, fontWeight: "500" }}>
                Удалить
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Основная рабочая область документа (безопасна для мобильных устройств) */}
        <View
          style={{
            flex: 1,
            width: "100%",
            minHeight: layout.compact ? 520 : 720,
            height: layout.compact ? 580 : 780,
            borderRadius: 12,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor:
              showSourceCode || previewArtifact.kind === "markdown" || !isWeb ? c.surface1 : "#ffffff",
          }}
        >
          {contentLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 14 }}>
                Загрузка содержимого артефакта...
              </Text>
            </View>
          ) : previewContent ? (
            showSourceCode ? (
              <ScrollView style={{ flex: 1, padding: 24 }}>
                <Markdown>{`\`\`\`${previewArtifact.kind}\n${previewContent}\n\`\`\``}</Markdown>
              </ScrollView>
            ) : previewArtifact.kind === "markdown" ? (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{
                  paddingHorizontal: layout.compact ? 16 : 36,
                  paddingVertical: 28,
                  maxWidth: 1080,
                  width: "100%",
                  alignSelf: "center",
                }}
              >
                <Markdown>{previewContent}</Markdown>
              </ScrollView>
            ) : isPdf ? (
              isWeb && SafeIframe ? (
                <SafeIframe
                  src={previewContent}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "none",
                  }}
                />
              ) : (
                <View
                  style={{
                    flex: 1,
                    padding: 24,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    backgroundColor: c.surface1,
                  }}
                >
                  <Icon name="FileText" size={48} color="#10b981" />
                  <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "700", textAlign: "center" }}>
                    {previewArtifact.title || previewArtifact.name}
                  </Text>
                  <Text
                    style={{
                      color: c.foregroundMuted,
                      fontSize: 13,
                      textAlign: "center",
                      maxWidth: 320,
                      lineHeight: 18,
                    }}
                  >
                    Встроенный просмотр PDF оптимизирован для компьютера. На телефоне выгрузите документ в Telegram или облако для удобного чтения.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSendTelegram()}
                    disabled={sendingTg}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      borderRadius: 9,
                      backgroundColor: c.accent,
                      opacity: pressed || sendingTg ? 0.8 : 1,
                    })}
                  >
                    <Icon name="Send" size={16} color="#fff" />
                    <Text style={{ color: "#fff", fontSize: 13.5, fontWeight: "600" }}>
                      {sendingTg ? "Отправляю в Telegram..." : "Отправить в Telegram"}
                    </Text>
                  </Pressable>
                </View>
              )
            ) : !isWeb ? (
              <ScrollView style={{ flex: 1, padding: 16 }}>
                <View
                  style={{
                    padding: 14,
                    marginBottom: 12,
                    borderRadius: 10,
                    backgroundColor: c.surface2,
                    borderWidth: 1,
                    borderColor: c.border,
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Text style={{ color: c.foreground, fontSize: 13.5, fontWeight: "600" }}>
                    Просмотр в Telegram
                  </Text>
                  <Text style={{ color: c.foregroundMuted, fontSize: 12, textAlign: "center" }}>
                    В приложении Telegram на айфоне этот HTML-документ открывается в нативном просмотрщике.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleSendTelegram()}
                    disabled={sendingTg}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 4,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 8,
                      backgroundColor: c.accent,
                      opacity: pressed || sendingTg ? 0.8 : 1,
                    })}
                  >
                    <Icon name="Send" size={15} color="#fff" />
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
                      {sendingTg ? "Отправляю..." : "Отправить в Telegram"}
                    </Text>
                  </Pressable>
                </View>
                <Markdown>{`\`\`\`${previewArtifact.kind}\n${previewContent}\n\`\`\``}</Markdown>
              </ScrollView>
            ) : (
              SafeIframe ? (
                <SafeIframe
                  srcDoc={previewContent}
                  sandbox="allow-scripts"
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "none",
                    backgroundColor: "#ffffff",
                  }}
                />
              ) : null
            )
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: c.foregroundMuted, fontSize: 14 }}>
                Содержимое артефакта недоступно
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.surface0 }}
      contentContainerStyle={{ padding: 20, gap: 16 }}
    >
      {/* Заголовок страницы */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              backgroundColor: "#f59e0b20",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="Layers" size={20} color="#f59e0b" />
          </View>
          <View>
            <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "700" }}>
              Галерея артефактов
            </Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 12.5, marginTop: 1 }}>
              Сохраненные HTML-страницы, SVG-схемы и документы вне зависимости от сессий
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => void reloadArtifacts()}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 8,
            backgroundColor: c.surface2,
            borderWidth: 1,
            borderColor: c.border,
            opacity: pressed || loading ? 0.7 : 1,
          })}
        >
          <Icon name="RefreshCw" size={14} color={c.foreground} />
          <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "500" }}>Обновить</Text>
        </Pressable>
      </View>

      {/* Панель фильтров */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          backgroundColor: c.surface1,
          padding: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          flexWrap: "wrap",
        }}
      >
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск по названию или проекту..."
          placeholderTextColor={c.foregroundMuted}
          style={{
            flex: 1,
            minWidth: 200,
            color: c.foreground,
            backgroundColor: c.surface2,
            borderRadius: 7,
            paddingHorizontal: 10,
            paddingVertical: 6,
            fontSize: 13,
            borderWidth: 1,
            borderColor: c.border,
          }}
        />

        {/* Фильтры по типам */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {(["all", "html", "svg", "markdown", "file"] as const).map((k) => {
            const active = selectedKind === k;
            const label =
              k === "all" ? "Все типы" : k === "file" ? "PDF / Файлы" : k;
            return (
              <Pressable
                key={k}
                accessibilityRole="button"
                onPress={() => setSelectedKind(k)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 6,
                  backgroundColor: active ? c.accent : c.surface2,
                  borderWidth: 1,
                  borderColor: active ? c.accent : c.border,
                }}
              >
                <Text
                  style={{
                    color: active ? "#ffffff" : c.foreground,
                    fontSize: 12,
                    fontWeight: active ? "600" : "400",
                    textTransform: k === "all" || k === "file" ? "none" : "uppercase",
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Список артефактов */}
      {filtered.length === 0 ? (
        <View
          style={{
            padding: 30,
            alignItems: "center",
            backgroundColor: c.surface1,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: c.border,
          }}
        >
          <Icon name="Inbox" size={32} color={c.foregroundMuted} />
          <Text style={{ color: c.foregroundMuted, fontSize: 14, marginTop: 8 }}>
            {artifacts.length === 0
              ? "Пока нет ни одного сохраненного артефакта"
              : "По выбранным фильтрам ничего не найдено"}
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {filtered.map((art) => {
            const isPdf = art.name.toLowerCase().endsWith(".pdf");
            const kindColor =
              art.kind === "html"
                ? "#f97316"
                : art.kind === "svg"
                ? "#a855f7"
                : isPdf
                ? "#10b981"
                : "#3b82f6";
            const kindIcon =
              art.kind === "html" ? "FileCode" : art.kind === "svg" ? "Image" : "FileText";

            return (
              <Pressable
                key={art.id}
                accessibilityRole="button"
                onPress={() => void handleOpen(art)}
                style={({ pressed }) => ({
                  width: layout.compact ? "100%" : "31.8%",
                  minWidth: 260,
                  backgroundColor: c.surface1,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: c.border,
                  padding: 14,
                  gap: 8,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      backgroundColor: `${kindColor}18`,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name={kindIcon} size={16} color={kindColor} />
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View
                      style={{
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        borderRadius: 4,
                        backgroundColor: `${kindColor}20`,
                      }}
                    >
                      <Text
                        style={{
                          color: kindColor,
                          fontSize: 10.5,
                          fontWeight: "700",
                          textTransform: "uppercase",
                        }}
                      >
                        {isPdf ? "PDF" : art.kind}
                      </Text>
                    </View>

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Удалить артефакт"
                      onPress={(e) => {
                        (e as any)?.stopPropagation?.();
                        void handleDelete(art.id);
                      }}
                      hitSlop={8}
                      style={({ pressed }) => ({
                        padding: 5,
                        borderRadius: 5,
                        backgroundColor: pressed ? "#ef444425" : c.surface2,
                        borderWidth: 1,
                        borderColor: pressed ? "#ef4444" : c.border,
                        opacity: pressed ? 0.9 : 0.7,
                      })}
                    >
                      <Icon name="Trash2" size={12} color="#ef4444" />
                    </Pressable>
                  </View>
                </View>

                <View>
                  <Text
                    numberOfLines={1}
                    style={{ color: c.foreground, fontSize: 14.5, fontWeight: "600" }}
                  >
                    {art.title || art.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ color: c.foregroundMuted, fontSize: 11.5, marginTop: 2 }}
                  >
                    {art.name} • {formatBytes(art.size)}
                  </Text>
                </View>

                {/* Бейджик проекта происхождения */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: "auto" }}>
                  {art.projectDisplayName || art.projectId ? (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 4,
                        backgroundColor: c.surface2,
                        borderWidth: 1,
                        borderColor: c.border,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          color: c.foregroundMuted,
                          fontSize: 10.5,
                          fontWeight: "500",
                        }}
                      >
                        {art.projectDisplayName || art.projectId}
                      </Text>
                    </View>
                  ) : null}

                  {art.yadiskUrl ? (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 1.5,
                        borderRadius: 4,
                        backgroundColor: "#e0f2fe",
                        marginLeft: "auto",
                      }}
                    >
                      <Text style={{ color: "#0284c7", fontSize: 9.5, fontWeight: "600" }}>
                        В облаке
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
