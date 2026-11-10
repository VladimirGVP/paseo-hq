import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GeminiApiLimitsCard } from "../../client/gemini-api.client";

const dark = location.search.includes("dark");
const theme = { colors: {
  foreground: dark ? "#f4f4f5" : "#18181b", foregroundMuted: dark ? "#a1a1aa" : "#52525b",
  surface0: dark ? "#09090b" : "#ffffff", surface1: dark ? "#18181b" : "#fafafa",
  surface2: dark ? "#27272a" : "#e4e4e7", border: dark ? "#3f3f46" : "#d4d4d8",
  accent: "#3b82f6", accentForeground: "#ffffff", statusDanger: "#ef4444",
  statusWarning: "#eab308", statusSuccess: "#22c55e",
} };
document.body.style.background = theme.colors.surface0;
document.body.style.fontFamily = "system-ui";
const props = { theme, compact: innerWidth < 600 } as Parameters<typeof GeminiApiLimitsCard>[0];
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <GeminiApiLimitsCard {...props} />
  </QueryClientProvider>,
);
