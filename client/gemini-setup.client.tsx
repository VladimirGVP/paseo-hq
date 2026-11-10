import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { GEMINI_HELP_SECTIONS } from "../shared/gemini-help.shared";
import { GEMINI_API_QUERY_KEY, readGeminiApiHelp, writeGeminiApiConfig, type GeminiApiConfig } from "../shared/gemini-api.shared";

export function GeminiSetup({ theme }: { theme: PluginTheme }) {
  const read = useRpc(readGeminiApiHelp);
  const write = useRpc(writeGeminiApiConfig);
  const cache = useQueryClient();
  const help = useQuery({ queryKey: ["gemini-api-help"], queryFn: () => read({}) });
  const [projectId, setId] = useState("");
  const [projectNumber, setNumber] = useState("");
  const [projectLabel, setLabel] = useState("");
  const [auth, setAuth] = useState<GeminiApiConfig["auth"]>("antigravity");
  const [quotaTier, setTier] = useState<GeminiApiConfig["quotaTier"]>("free");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const config = help.data?.config;
    if (config) { setId(config.projectId); setNumber(config.projectNumber); setLabel(config.projectLabel); setAuth(config.auth); setTier(config.quotaTier); }
  }, [help.data]);
  const c = theme.colors;
  const text = { color: c.foreground, fontSize: 13 };
  const button = { borderColor: c.border, borderWidth: 1, padding: 10, borderRadius: 8 };
  const submit = async () => {
    setSaving(true); setMessage("");
    try {
      await write({ projectId: projectId.trim(), projectNumber: projectNumber.trim(), projectLabel: projectLabel.trim(), auth, quotaTier,
        usageStatus: projectNumber.trim() === help.data?.config?.projectNumber ? help.data.config.usageStatus : "not-connected",
        models: help.data?.config?.models ?? ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-tts"] });
      await cache.invalidateQueries({ queryKey: GEMINI_API_QUERY_KEY }); setMessage("Настройки сохранены. Ограничения запрошены у Google.");
    } catch { setMessage("Не удалось сохранить. Проверьте Project ID, числовой Project number и название проекта."); }
    finally { setSaving(false); }
  };
  return <View style={{ gap: 12 }}>
    {GEMINI_HELP_SECTIONS.map(section => <View key={section.title} style={{ gap: 5 }}><Text style={{ ...text, fontWeight: "600" }}>{section.title}</Text><Text style={{ ...text, color: c.foregroundMuted }}>{section.detail}</Text></View>)}
    {help.error ? <Text style={{ ...text, color: c.statusDanger }}>Не удалось прочитать настройки проекта: {help.error.message}</Text> : null}
    {([ ["Project ID", projectId, setId], ["Project number", projectNumber, setNumber], ["Название проекта", projectLabel, setLabel] ] as const).map(([label, value, onChangeText]) => <View key={label} style={{ gap: 4 }}><Text style={text}>{label}</Text><TextInput accessibilityLabel={label} style={{ ...button, ...text, backgroundColor: c.surface0 }} value={value} onChangeText={onChangeText} autoCapitalize="none" autoCorrect={false} /></View>)}
    <Text style={text}>Вход Google на хосте</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["antigravity", "gcloud"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: auth === value }} onPress={() => setAuth(value)} style={{ ...button, borderColor: auth === value ? c.accent : c.border }}><Text style={text}>{value === "antigravity" ? "Antigravity CLI" : "Google Cloud CLI"}</Text></Pressable>)}</View>
    <Text style={text}>Пул ограничений (проверьте свой тариф в AI Studio)</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{(["free", "paid", "paid-2", "paid-3"] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: quotaTier === value }} onPress={() => setTier(value)} style={{ ...button, borderColor: quotaTier === value ? c.accent : c.border }}><Text style={text}>{value}</Text></Pressable>)}</View>
    <Pressable accessibilityRole="button" disabled={saving || help.isPending || !!help.error} onPress={() => { void submit(); }} style={button}><Text style={{ ...text, color: c.accent }}>{saving ? "Сохранение…" : "Подключить живые ограничения"}</Text></Pressable>
    {message ? <Text accessibilityLiveRegion="polite" style={text}>{message}</Text> : null}
    {projectNumber.match(/^\d+$/) ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["serviceusage", "monitoring"].map(service => <Pressable key={service} accessibilityRole="button" style={button} onPress={() => { void openExternalUrl(`https://console.developers.google.com/apis/api/${service}.googleapis.com/overview?project=${projectNumber}`).catch(() => setMessage("Не удалось открыть Google")); }}><Text style={{ ...text, color: c.accent }}>{service === "serviceusage" ? "Service Usage API" : "Monitoring API"}</Text></Pressable>)}</View> : null}
  </View>;
}
