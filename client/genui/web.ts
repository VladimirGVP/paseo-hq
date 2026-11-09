import type { PluginTheme } from "@getpaseo/plugin";
import { Platform } from "react-native";

interface WebStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface WebIframeElement {
  title: string;
  srcdoc: string;
  referrerPolicy: string;
  readonly contentWindow: unknown;
  readonly style: {
    width: string;
    height: string;
    border: string;
    display: string;
    borderRadius: string;
    backgroundColor: string;
  };
  setAttribute(name: string, value: string): void;
  remove(): void;
}

interface WebContainerElement {
  innerHTML: string;
  appendChild(child: WebIframeElement): void;
}

interface WebMessageEvent {
  readonly source: unknown;
  readonly data: unknown;
}

interface WebGlobal {
  readonly localStorage?: WebStorage;
  readonly document?: {
    createElement(tag: "iframe"): WebIframeElement;
  };
  readonly window?: {
    addEventListener(type: "message", listener: (event: WebMessageEvent) => void): void;
    removeEventListener(type: "message", listener: (event: WebMessageEvent) => void): void;
    readonly location?: { readonly pathname: string };
    readonly history?: { pushState(state: null, unused: string, url: string): void };
    dispatchEvent?(event: unknown): boolean;
  };
  readonly PopStateEvent?: new (type: "popstate") => unknown;
}

const memoryStore = new Map<string, string>();

function getWeb(): WebGlobal | null {
  if (Platform.OS !== "web") return null;
  return globalThis as unknown as WebGlobal;
}

export function readStorage(key: string): string | null {
  const web = getWeb();
  if (web?.localStorage) {
    try {
      return web.localStorage.getItem(key);
    } catch {
      // Fall back to memory store
    }
  }
  return memoryStore.get(key) ?? null;
}

export function writeStorage(key: string, value: string): void {
  memoryStore.set(key, value);
  const web = getWeb();
  if (web?.localStorage) {
    try {
      web.localStorage.setItem(key, value);
    } catch {
      // Ignore quota errors
    }
  }
}

export function canRenderWebIframe(): boolean {
  const web = getWeb();
  return Platform.OS === "web" && Boolean(web?.document && web?.window);
}

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

const BASE_STYLES = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent}
html{color:var(--foreground);font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.5}
code,kbd,pre,samp{font-family:ui-monospace,monospace}
img,video,canvas{max-width:100%}
button,input,select,textarea{font:inherit;color:inherit;margin:0}
button{cursor:pointer;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--background);line-height:1.25}
input,select,textarea{padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--background)}`;

const BOOTSTRAP = `(function(){
var host=window.parent,last=-1;
function post(m){m.source="genui-app";host.postMessage(m,"*");}
function measure(){
var b=document.body,h=Math.ceil(Math.max(document.documentElement.getBoundingClientRect().height,b?b.scrollHeight:0));
if(h!==last){last=h;post({type:"height",height:h});}
}
var ro=new ResizeObserver(measure);
ro.observe(document.documentElement);
document.addEventListener("DOMContentLoaded",function(){if(document.body)ro.observe(document.body);measure();});
addEventListener("load",measure);
addEventListener("error",function(e){post({type:"error",message:String(e.message||"Script error")});});
})();`;

function buildSrcdoc(html: string, theme: PluginTheme): string {
  const c = theme.colors;
  const vars = [
    `--background:${c.surface0}`,
    `--card:${c.surface1}`,
    `--muted:${c.surface2}`,
    `--border:${c.border}`,
    `--foreground:${c.foreground}`,
    `--muted-foreground:${c.foregroundMuted}`,
    `--subtle-foreground:${c.foregroundMuted}`,
    `--primary:${c.accent}`,
    `--primary-foreground:${c.accentForeground}`,
    `--accent:${c.accent}`,
    `--success:${c.statusSuccess}`,
    `--warning:${c.statusWarning}`,
    `--destructive:${c.statusDanger}`,
  ].join(";");
  const doctype = "<!doctype html>";
  const metaCsp = '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">';
  const metaVp = '<meta name="viewport" content="width=device-width,initial-scale=1">';
  const styleBase = "<style>" + BASE_STYLES + "</style>";
  const styleTheme = '<style id="genui-theme">:root{' + vars + "}</style>";
  const scriptBoot = "<script>" + BOOTSTRAP + "</script>";
  return [doctype, metaCsp, metaVp, styleBase, styleTheme, scriptBoot, html].join("\n");
}

export function mountSandboxedAppIframe(
  hostRef: unknown,
  options: {
    html: string;
    theme: PluginTheme;
    height: number;
    onHeight(height: number): void;
    onError(message: string): void;
  },
): () => void {
  const web = getWeb();
  if (!web?.document || !web.window || !hostRef || typeof hostRef !== "object") {
    return () => {};
  }
  const container = hostRef as WebContainerElement;
  if (typeof container.appendChild !== "function") return () => {};

  const iframe = web.document.createElement("iframe");
  iframe.title = "Interactive App";
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.referrerPolicy = "no-referrer";
  iframe.style.width = "100%";
  iframe.style.height = `${options.height}px`;
  iframe.style.border = "0";
  iframe.style.display = "block";
  iframe.style.borderRadius = "8px";
  iframe.style.backgroundColor = "transparent";
  iframe.srcdoc = buildSrcdoc(options.html, options.theme);

  container.innerHTML = "";
  container.appendChild(iframe);

  const onMessage = (event: WebMessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    if (typeof event.data !== "object" || event.data === null) return;
    const data = event.data as Record<string, unknown>;
    if (data.source !== "genui-app") return;
    if (data.type === "height" && typeof data.height === "number" && Number.isFinite(data.height)) {
      const clamped = Math.min(1400, Math.max(80, Math.ceil(data.height)));
      iframe.style.height = `${clamped}px`;
      options.onHeight(clamped);
    } else if (data.type === "error" && typeof data.message === "string") {
      options.onError(data.message.slice(0, 500));
    }
  };

  web.window.addEventListener("message", onMessage);
  return () => {
    web.window?.removeEventListener("message", onMessage);
    iframe.remove();
  };
}

/**
 * Opens an absolute file path in a file tab of the workspace on screen, the way the
 * host does for file links in chat. The plugin SDK has no call for it, so this goes
 * through the host's `?open=file:<base64url path>` route. Web and desktop only.
 */
export function openWorkspaceFile(path: string): boolean {
  const web = getWeb();
  const win = web?.window;
  if (!win?.location || !win.history || !win.dispatchEvent || !web?.PopStateEvent) return false;
  if (!path.startsWith("/")) return false;
  const match = /^\/h\/[^/]+\/workspace\/[^/]+/.exec(win.location.pathname);
  if (match === null) return false;
  const token = btoa(unescape(encodeURIComponent(path))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  win.history.pushState(null, "", `${match[0]}?open=${encodeURIComponent(`file:${token}`)}`);
  win.dispatchEvent(new web.PopStateEvent("popstate"));
  return true;
}
