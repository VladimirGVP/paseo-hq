// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.[cm]?tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function classesIn(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      found.push(`${path.relative(root, file)}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("Hermes compatibility", () => {
  // Hermes (React Native) has no `class` syntax, and Paseo compiles plugin client
  // bundles for es2020, so `class` would reach it. server/ runs in Node and may use it.
  it("keeps `class` out of client and shared code; use defineClass", () => {
    const files = [
      ...sourceFiles(path.join(root, "client", "genui")),
      ...sourceFiles(path.join(root, "shared", "genui")),
    ];
    expect(files.flatMap(classesIn)).toEqual([]);
  }, 30_000); // Parsing every file takes ~5 s under a full parallel run, past vitest's 5 s default.
});
