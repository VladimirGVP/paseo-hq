import { describe, it, expect } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { GitLoginService } from "./git-login.server";

describe("Git device sign-in", () => {
  it.each(["github", "gitlab"] as const)("%s exposes a code/link then confirms completion, without exposing tokens", async (provider) => {
    let child: ChildProcessWithoutNullStreams;
    const service = new GitLoginService({ launch: () => child = spawn(process.execPath, ["-e", `process.stderr.write('First copy your one-time code: ABCD-EFGH\\n'); process.stdin.on('data', x => {if(String(x).includes('finish')) process.exit(0)});`]) });
    try {
      const started = service.start(provider, "gitlab.com");
      await once(child!.stderr, "data");
      expect(service.get(started.id)).toMatchObject({ state: "waiting", code: "ABCD-EFGH", verificationUrl: provider === "github" ? "https://github.com/login/device" : "https://gitlab.com/oauth/device" });
      expect(service.start(provider, "gitlab.com").id).toBe(started.id);
      child!.stdin.write("finish\n"); await once(child!, "close");
      expect(service.get(started.id)).toMatchObject({ state: "complete" });
      expect(JSON.stringify(service.get(started.id))).not.toContain("token");
    } finally { service.dispose(); }
  });

  it("cancels only its login process and leaves the existing account intact", async () => {
    let child: ChildProcessWithoutNullStreams;
    const service = new GitLoginService({ launch: () => child = spawn(process.execPath, ["-e", "process.stderr.write('code: ABCD-EFGH\\n'); setInterval(()=>{},10000)"]) });
    const login = service.start("github"); await once(child!.stderr, "data");
    const closed = once(child!, "close"); expect(service.cancel(login.id).state).toBe("cancelled"); await closed;
    expect(service.get(login.id).state).toBe("cancelled"); service.dispose();
  });

  it("reports a failed login and never returns a raw credential", async () => {
    let child: ChildProcessWithoutNullStreams;
    const service = new GitLoginService({ launch: () => child = spawn(process.execPath, ["-e", "process.stderr.write('OAuth denied glpat-example-test-token'); process.exit(1)"]) });
    const login = service.start("gitlab"); await once(child!, "close");
    expect(service.get(login.id)).toMatchObject({ state: "failed" });
    expect(service.get(login.id).error).toContain("OAuth denied");
    expect(JSON.stringify(service.get(login.id))).not.toContain("example-test-token"); service.dispose();
  });
});
