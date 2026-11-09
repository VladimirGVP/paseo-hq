import type { Diagnostic } from "./types";
import { defineClass } from "./define-class";

/** A 1-based source position. Tokens and AST nodes carry one. */
export interface Pos {
  readonly line: number;
  readonly column: number;
}

const MAX_DIAGNOSTICS = 20;

interface DiagnosticListFields {
  items: Diagnostic[];
  hasErrors: boolean;
  seen: Set<string>;
}

/** Collects up to 20 diagnostics, dropping exact duplicates. */
export const DiagnosticList = defineClass(
  function (this: DiagnosticListFields): void {
    this.items = [];
    this.hasErrors = false;
    this.seen = new Set<string>();
  },
  {
    report(pos: Pos, message: string, severity: Diagnostic["severity"] = "error"): void {
      if (severity === "error") this.hasErrors = true;
      const id = `${pos.line}:${pos.column}:${message}`;
      if (this.items.length >= MAX_DIAGNOSTICS || this.seen.has(id)) return;
      this.seen.add(id);
      this.items.push({ severity, line: pos.line, column: pos.column, message });
    },
  },
);
export type DiagnosticList = InstanceType<typeof DiagnosticList>;
