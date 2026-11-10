import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  GEMINI_API_LINKS, GEMINI_API_QUERY_KEY, readGeminiApiLimits,
  type GeminiApiSnapshot,
} from "../shared/gemini-api.shared";

function amount(value: number | null): string {
  return value === null ? "Нет данных" : value.toLocaleString("ru-RU");
}

export function GeminiApiLimitsCard({ theme, compact }: { theme: PluginTheme; compact: boolean }) {
  const read = useRpc(readGeminiApiLimits);
  const query = useQuery({
    queryKey: GEMINI_API_QUERY_KEY,
    queryFn: () => read({}),
    refetchInterval: 60_000,
  });
  return <GeminiApiReport theme={theme} compact={compact} snapshot={query.data?.snapshot ?? null}
    pending={query.isPending} error={query.error?.message ?? null}
    refreshing={query.isFetching} onRefresh={() => { void query.refetch(); }} />;
}

export function GeminiApiReport({ theme, compact, snapshot, pending = false, error = null, refreshing = false, onRefresh }: {
  theme: PluginTheme; compact: boolean; snapshot: GeminiApiSnapshot | null;
  pending?: boolean; error?: string | null; refreshing?: boolean; onRefresh?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const colors = theme.colors;
  const small = { color: colors.foregroundMuted, fontSize: compact ? 11 : 12 };
  const text = { color: colors.foreground, fontSize: compact ? 13 : 14 };
  const button = { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 };
  const models = snapshot?.models ?? [];
  const visible = expanded ? models : models.slice(0, 2);
  return <View testID="gemini-api-limits" style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface1, padding: compact ? 12 : 16, gap: 12 }}>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <Text style={{ ...text, fontWeight: "600", fontSize: 16 }}>Gemini API</Text>
      {snapshot ? <Text style={small}>{snapshot.project} · {snapshot.tier === "free" ? "Free tier" : snapshot.tier === "paid" ? "Paid tier" : "Тариф не известен"}</Text> : null}
    </View>
    <Text style={small}>API озвучки и моделей. Квоты проекта общие для его ключей и пользователей, отдельно от Antigravity.</Text>
    {pending ? <Text style={small}>Загрузка снимка API…</Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ ...text, color: colors.statusDanger }}>{error}{snapshot ? ". Показан предыдущий снимок." : ""}</Text> : null}
    {snapshot ? <>
      <Text style={small}>Снимок AI Studio от {new Date(snapshot.capturedAt).toLocaleString("ru-RU")}. Пики за {snapshot.periodDays} дней, не текущий остаток.</Text>
      <Text style={{ ...small, color: colors.statusWarning }}>Автообновление Google не подключено. Текущие значения - по кнопке «Живые лимиты».</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {visible.map(model => <View key={model.id} style={{ flexGrow: 1, flexBasis: compact ? "100%" : 300, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, gap: 10 }}>
          <Text style={{ ...text, fontWeight: "600" }}>{model.label}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {([ ["rpm", "RPM · в минуту"], ["tpm", "TPM · токены"], ["rpd", "RPD · в сутки"] ] as const).map(([key, label]) => {
              const { peak, limit } = model[key];
              const reached = peak !== null && limit !== null && (limit > 0 ? peak >= limit : peak > 0);
              const percent = peak === null || limit === null || limit <= 0 ? null : Math.min(100, peak / limit * 100);
              const color = reached ? colors.statusDanger : colors.accent;
              return <View key={key} style={{ flex: 1, minWidth: 0, gap: 5 }}>
                <Text style={small}>{label}</Text>
                <Text style={{ ...text, fontSize: compact ? 12 : 13, color: reached ? colors.statusDanger : colors.foreground }}>{amount(peak)} / {amount(limit)}</Text>
                {percent === null ? null : <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" }}><View style={{ height: 4, width: `${percent}%`, backgroundColor: color }} /></View>}
                {reached ? <Text style={{ ...small, color: colors.statusDanger }}>Пик достиг лимита</Text> : null}
              </View>;
            })}
          </View>
        </View>)}
      </View>
      {models.length === 0 ? <Text style={small}>В снимке нет моделей.</Text> : null}
      {models.length > 2 ? <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={button}><Text style={text}>{expanded ? "Скрыть остальные модели" : `Все модели (${models.length})`}</Text></Pressable> : null}
    </> : !pending && !error ? <Text style={small}>Статистика API пока не подключена. Откройте AI Studio, чтобы посмотреть лимиты и расход. Наличие подписки Pro не подтверждает платный тариф API.</Text> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {GEMINI_API_LINKS.map(link => <Pressable key={link.url} accessibilityRole="button" onPress={() => {
        setLinkError(null);
        void openExternalUrl(link.url).catch(() => setLinkError("Не удалось открыть Google. Попробуйте еще раз."));
      }} style={button}><Text style={{ ...text, color: colors.accent }}>{link.label}</Text></Pressable>)}
      {snapshot && onRefresh ? <Pressable accessibilityRole="button" disabled={refreshing} onPress={onRefresh} style={button}><Text style={small}>{refreshing ? "Чтение снимка…" : "Перечитать снимок"}</Text></Pressable> : null}
    </View>
    {linkError ? <Text accessibilityRole="alert" style={{ ...small, color: colors.statusDanger }}>{linkError}</Text> : null}
  </View>;
}
