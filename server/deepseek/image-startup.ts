import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, isMap, isScalar, parseDocument } from "yaml";

/**
 * rc.5's shipped ACP profile still selects v4-flash, while its base profile
 * selects deepseek-flash. Inspect DSH's public, boot-free config dump.
 * Never evaluate !!js, edit DSH_HOME or invent an ACP image capability.
 */
export function imageStartupRepair(source: string): string | undefined {
  if (Buffer.byteLength(source) > 256 * 1024) return;
  try {
    const doc = parseDocument(source);
    if (doc.errors.length > 0) return;
    const entries: unknown = doc.toJS({ maxAliasCount: 20 });
    if (!Array.isArray(entries)) return;
    const indexes = ["acp", "agent-default-model"].map((id) => {
      const matches = entries.flatMap((entry, index) =>
        typeof entry === "object" && entry !== null && entry.id === id ? [index] : []);
      return matches.length === 1 ? matches[0] : -1;
    });
    if (indexes.includes(-1)) return;
    for (const index of indexes) {
      if (doc.getIn([index, "disabled"])) return;
      for (const path of [["name"], ["config", "provider"], ["config", "model"]]) {
        const node = doc.getIn([index, ...path], true);
        if (!isScalar(node) || node.tag && node.tag !== "tag:yaml.org,2002:str") return;
      }
    }
    const [acp, defaults] = indexes;
    if (doc.getIn([acp, "name"]) !== "@deepseek-ai/dsh-acp"
      || doc.getIn([acp, "config", "provider"]) !== "deepseek-official"
      || doc.getIn([acp, "config", "model"]) !== "deepseek-v4-flash"
      || doc.getIn([defaults, "name"]) !== "@deepseek-ai/dsh-agent-default-model"
      || doc.getIn([defaults, "config", "provider"]) !== "deepseek-official"
      || doc.getIn([defaults, "config", "model"]) !== "deepseek-flash") return;
    const config = doc.getIn([acp, "config"], true);
    if (!isMap(config)) return;
    // DSH replaces the whole config map; retain provider and every other field.
    const patch = new Document([{ id: "acp", config: config.clone() }]);
    patch.setIn([0, "config", "model"], "deepseek-flash");
    const content = patch.toString();
    // A cloned map must not leave references to anchors outside that map.
    parseDocument(content).toJS({ maxAliasCount: 20 });
    return content;
  } catch {
    return;
  }
}

/** A process-local overlay, removed with its ACP stream. */
export async function createImageStartupPatch(content: string): Promise<{
  path: string;
  close(): Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "paseo-dsh-image-"));
  const path = join(directory, "acp.patch.yml");
  const close = () => rm(directory, { recursive: true, force: true });
  try {
    await writeFile(path, content, { mode: 0o600 });
    return { path, close };
  } catch (error) {
    await close();
    throw error;
  }
}
