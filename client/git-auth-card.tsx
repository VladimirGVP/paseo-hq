import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl, useRpc, useSettings } from "@getpaseo/plugin/client";
import { gitWorkspaceSettings } from "../shared/git-settings";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { StartGitLoginRpc, GetGitLoginRpc, CancelGitLoginRpc, type AuthStatus, type GitLoginState } from "../shared/git-contracts";

export function GitAuthCard({ provider, status, gitlabUrl, theme, onConnected }: {
  provider: "github" | "gitlab"; status?: AuthStatus; gitlabUrl: string; theme: PluginTheme; onConnected: () => Promise<void>;
}) {
  const start = useRpc(StartGitLoginRpc), read = useRpc(GetGitLoginRpc), cancel = useRpc(CancelGitLoginRpc);
  const settings = useSettings(gitWorkspaceSettings);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [login, setLogin] = useState<GitLoginState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const connected = useRef(onConnected); connected.current = onConnected;
  const label = provider === "github" ? "GitHub" : "GitLab";
  const waiting = login?.state === "starting" || login?.state === "waiting";
  const c = theme.colors;
  useEffect(() => {
    if (!login?.id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await read({ id: login.id });
        if (disposed) return;
        setLogin(next);
        if (next.state === "complete") {
          const current = settingsRef.current;
          if (current.status === "ready") {
            await current.save({ ...current.values, ...(provider === "github" ? { githubCloneProtocol: "https" as const } : { cloneProtocol: "https" as const }) }, current.revision);
          }
          await connected.current(); return;
        }
        if (next.state === "starting" || next.state === "waiting") timer = setTimeout(() => void poll(), 1500);
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [login?.id, read]);

  const begin = async () => {
    setStarting(true); setError(null); setCopied(false);
    try { setLogin(await start({ provider, gitlabUrl })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setStarting(false); }
  };
  const button = (text: string, onPress: () => void, disabled = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={text} disabled={disabled} onPress={onPress}
      style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 8, backgroundColor: c.surface2, opacity: disabled ? 0.5 : 1 }}>
      <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 13 }}>{text}</Text>
    </Pressable>
  );
  return <View style={{ flex: 1, minWidth: 240, gap: 9, padding: 12, borderRadius: 10, backgroundColor: c.surface1, borderColor: c.border, borderWidth: 1 }}>
    <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "700" }}>{label}{provider === "gitlab" ? ` (${status?.host || "gitlab.com"})` : ""}</Text>
    <Text style={{ color: status?.loggedIn ? c.statusSuccess : c.foregroundMuted, fontSize: 13 }}>
      {status?.loggedIn ? `@${status.user || "подключен"}` : "Вход не выполнен"}
    </Text>
    {!waiting ? button(starting ? "Начинаем вход..." : `${status?.loggedIn ? "Войти заново в" : "Войти в"} ${label}`, () => void begin(), starting) : null}
    {login?.state === "starting" ? <Text style={{ color: c.foregroundMuted }}>Получаем код входа...</Text> : null}
    {login?.state === "waiting" && login.code ? <>
      <Text style={{ color: c.foreground, fontSize: 13 }}>Откройте страницу {label} и введите одноразовый код:</Text>
      <Text selectable style={{ color: c.foreground, fontSize: 24, fontFamily: "monospace", fontWeight: "700" }}>{login.code}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {button(copied ? "Код скопирован" : "Копировать код", () => { void copyText(login.code!).then(() => setCopied(true), (cause) => setError(String(cause))); })}
        {button(`Открыть ${label}`, () => { void openExternalUrl(login.verificationUrl!).catch((cause) => setError(String(cause))); })}
      </View>
      <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>После подтверждения список обновится автоматически.</Text>
    </> : null}
    {waiting ? button("Отменить вход", () => { if (login) void cancel({ id: login.id }).then(setLogin, (cause) => setError(String(cause))); }) : null}
    {login?.state === "complete" ? <Text style={{ color: c.statusSuccess }}>Вход выполнен</Text> : null}
    {error || login?.error ? <Text selectable style={{ color: c.statusDanger, fontSize: 12 }}>{error || login?.error}</Text> : null}
  </View>;
}
