import React from "react";
import { createRoot } from "react-dom/client";
import { GitWorkspaceSurface } from "../../client/git-workspace-surface";
const dark = location.search.includes("dark");
const colors = { foreground: dark ? "#f4f4f5" : "#18181b", foregroundMuted: dark ? "#a1a1aa" : "#52525b", surface0: dark ? "#09090b" : "#fff", surface1: dark ? "#18181b" : "#fafafa", surface2: dark ? "#27272a" : "#e4e4e7", border: dark ? "#3f3f46" : "#d4d4d8", accent: "#2563eb", accentForeground: "#fff", statusDanger: "#ef4444", statusSuccess: "#22c55e", statusWarning: "#f59e0b" };
document.body.style.background = colors.surface0;
document.body.style.fontFamily = "system-ui";
createRoot(document.getElementById("root")!).render(<GitWorkspaceSurface {...{ theme: { colors }, layout: { compact: innerWidth < 600, platform: "web" } } as Parameters<typeof GitWorkspaceSurface>[0]} />);
