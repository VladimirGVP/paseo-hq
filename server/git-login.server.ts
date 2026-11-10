import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { GitLoginState } from "../shared/git-contracts";
import { gitCliExecutable, parseGitLabHost } from "./git-service.server";
import { redactSecrets } from "./redact.server";

type Launch = (binary: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;
interface Session { value: GitLoginState; child: ChildProcessWithoutNullStreams; output: string; timer: NodeJS.Timeout }
const active = (value: GitLoginState) => value.state === "starting" || value.state === "waiting";
const safeError = (value: string) => redactSecrets(value).replace(/\b(?:gh[pousr]_[\w-]+|github_pat_[\w-]+|glpat-[\w-]+)\b/g, "[REDACTED]").slice(-1000);

/** CLI owns OAuth credentials; only the one-time verification code crosses RPC. */
export class GitLoginService {
  private sessions = new Map<string, Session>();
  private launch: Launch;
  constructor(options: { launch?: Launch } = {}) {
    this.launch = options.launch ?? ((binary, args, env) => spawn(binary, args, { env, stdio: "pipe" }));
  }

  start(provider: "github" | "gitlab", gitlabUrl?: string): GitLoginState {
    const host = provider === "github" ? "github.com" : parseGitLabHost(gitlabUrl);
    if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error("Некорректный адрес GitLab");
    for (const session of this.sessions.values()) {
      if (session.value.provider === provider && session.value.host === host && active(session.value)) return { ...session.value };
    }
    // Expired/finished sessions have no credentials and need no persistent storage.
    if (this.sessions.size > 20) for (const [id, session] of this.sessions) if (!active(session.value)) this.sessions.delete(id);
    const args = provider === "github"
      ? ["auth", "login", "--hostname", host, "--web", "--git-protocol", "https", "--skip-ssh-key", "--scopes", "repo,read:org"]
      : ["auth", "login", "--hostname", host, "--device", "--git-protocol", "https", "--api-protocol", "https", "--container-registry-domains", host];
    const child = this.launch(gitCliExecutable(provider), args, { ...process.env, NO_COLOR: "1", GH_BROWSER: "true", BROWSER: "true", GLAB_CHECK_UPDATE: "false" });
    const value: GitLoginState = { id: randomUUID(), provider, host, state: "starting" };
    const session: Session = { value, child, output: "", timer: setTimeout(() => {
      if (!active(value)) return;
      value.state = "failed"; value.error = "Время входа истекло. Начните заново."; child.kill("SIGTERM");
    }, 10 * 60_000) };
    session.timer.unref();
    this.sessions.set(value.id, session);
    const read = (chunk: Buffer | string) => {
      session.output = (session.output + String(chunk)).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").slice(-8192);
      const code = /[Cc]ode[^\n]*?\b([A-Z0-9]{4}-[A-Z0-9]{4}|[A-Z0-9]{8})\b/.exec(session.output)?.[1];
      if (code && value.state === "starting") {
        value.code = code;
        value.verificationUrl = provider === "github" ? "https://github.com/login/device" : `https://${host}/oauth/device`;
        value.state = "waiting";
        // Some CLI versions wait for Enter before starting the polling loop.
        if (!child.stdin.destroyed) child.stdin.write("\n");
      }
    };
    child.stdout.on("data", read); child.stderr.on("data", read);
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && active(value)) { value.state = "failed"; value.error = safeError(error.message); child.kill("SIGTERM"); }
    });
    child.once("error", (error) => {
      clearTimeout(session.timer);
      if (!active(value)) return;
      value.state = "failed"; value.error = safeError(error.message);
    });
    child.once("close", (code) => {
      clearTimeout(session.timer);
      if (!active(value)) return;
      value.state = code === 0 ? "complete" : "failed";
      if (code !== 0) value.error = safeError(session.output.trim() || "Не удалось выполнить вход. Проверьте установленную версию CLI.");
      delete value.code; delete value.verificationUrl;
    });
    return { ...value };
  }

  get(id: string): GitLoginState {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Вход не найден. Начните заново.");
    return { ...session.value };
  }
  cancel(id: string): GitLoginState {
    const session = this.sessions.get(id);
    if (!session) throw new Error("Вход не найден");
    if (active(session.value)) {
      session.value.state = "cancelled"; clearTimeout(session.timer); session.child.kill("SIGTERM");
      delete session.value.code; delete session.value.verificationUrl;
    }
    return { ...session.value };
  }
  dispose() { for (const session of this.sessions.values()) if (active(session.value)) this.cancel(session.value.id); }
}
