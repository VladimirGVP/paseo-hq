import React from "react";
import { createRoot } from "react-dom/client";
import { TimelineBlockItem } from "../../client/genui/live-ui";
import { splitHqTimelineMessage } from "../../client/hq-timeline";
import { GalleryScreen } from "../../client/genui/gallery";
import contribute from "../../client/genui/contribute";

const dark = location.search.includes("dark");
const colors = { foreground: dark ? "#f4f4f5" : "#18181b", foregroundMuted: dark ? "#a1a1aa" : "#52525b", surface0: dark ? "#09090b" : "#fff", surface1: dark ? "#18181b" : "#fafafa", surface2: dark ? "#27272a" : "#e4e4e7", border: dark ? "#3f3f46" : "#d4d4d8", accent: "#2563eb", accentForeground: "#fff", statusDanger: "#ef4444", statusSuccess: "#22c55e", statusWarning: "#f59e0b" };
const theme = { colors, mode: dark ? "dark" : "light" };
const code = `$n = 3
rows = Load("/tmp/opencode/hq-genui/rows.json")
Card("Штаб: интерактивный ответ", [
  Stepper($n, 1, 10, label: "Количество"),
  Metric("Итого", $n * 7),
  Table(["Проверка", "Значение"], rows),
  Button("Применить", Send("Количество " + $n))
])`;
const fence = (lang: string, body: string) => "```" + lang + "\n" + body + "\n```";
const items = splitHqTimelineMessage([fence("ui", code), fence("app", '<html><body><button id="app">App works</button></body></html>')].join("\n"), "complete", "smoke")!.items;
const registrations: Record<string, unknown[]> = {};
const client = new Proxy({}, { get: (_, key: string) => (entry: unknown) => { (registrations[key] ??= []).push(entry); return () => {}; } });
contribute(client as Parameters<typeof contribute>[0]);
(globalThis as unknown as { registrations: unknown }).registrations = registrations;
document.body.style.background = colors.surface0;
createRoot(document.getElementById("root")!).render(location.search.includes("gallery") ? <GalleryScreen {...{ theme, layout: { compact: innerWidth < 600, platform: "web" }, params: { component: "Card" }, playAudio: async () => {} } as unknown as Parameters<typeof GalleryScreen>[0]} /> : <div style={{ maxWidth: 900, margin: "auto", padding: 12 }}>
  {items.map((item, index) => <TimelineBlockItem key={index} {...{ agentId: "smoke", item, timestamp: new Date(0), theme, layout: { compact: innerWidth < 600, platform: "web" }, playAudio: async () => {} } as unknown as Parameters<typeof TimelineBlockItem>[0]} />)}
  <div id="sent" />
</div>);
