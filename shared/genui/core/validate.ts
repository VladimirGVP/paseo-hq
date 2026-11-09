import type { ArrowExpr, CallExpr, Decl, Expr, Program, Statement } from "./ast";
import {
  ACTIONS,
  COMPONENTS,
  FORBIDDEN_PROPERTIES,
  FUNCTIONS,
  METHODS,
  type ComponentSpec,
  type FunctionName,
  type ParamKind,
  type ParamSpec,
  type StateKind,
} from "./catalog";
import type { DiagnosticList, Pos } from "./diagnostics";
import { loadPath } from "./data";
import type { Value } from "./types";
import { defineClass } from "./define-class";

// Maps, not the catalog objects, so spec-controlled names like `constructor`
// never hit Object.prototype.
export const COMPONENT_SPECS: ReadonlyMap<string, ComponentSpec> = new Map(Object.entries(COMPONENTS));
export const ACTION_SPECS: ReadonlyMap<string, ComponentSpec> = new Map(Object.entries(ACTIONS));

type MethodName = (typeof METHODS)[keyof typeof METHODS][number];

/** Methods whose single argument is an arrow `(item, index?) => ...`. */
export const LAMBDA_METHODS: ReadonlySet<string> = new Set(["map", "filter", "find", "some", "every", "findIndex", "flatMap"]);

/** What a method's function receives, for those that take one. */
export const FUNCTION_PARAMS: ReadonlyMap<string, readonly string[]> = new Map([
  ...[...LAMBDA_METHODS].map((name): [string, readonly string[]] => [name, ["item", "index"]]),
  ["sort", ["a", "b"]],
  ["reduce", ["total", "item", "index"]],
]);

/** A method's function argument; a declared function's name, as in `rows.map(row)`, becomes `(a, b) => row(a, b)`. */
export function functionArg(arg: Expr, named: ReadonlyMap<string, Decl>, method: string, params: readonly string[] = []): Expr {
  if (arg.type !== "ident" || params.includes(arg.name)) return arg;
  const own = named.get(arg.name)?.value;
  if (own?.type !== "arrow") return arg;
  // `#` cannot appear in a written name, so these never shadow anything.
  const names = own.params.slice(0, FUNCTION_PARAMS.get(method)?.length ?? 2).map((_, index) => `#${index}`);
  const args = names.map((name): Expr => ({ type: "ident", name, pos: arg.pos }));
  return { type: "arrow", params: names, body: { type: "call", name: arg.name, args, named: [], pos: arg.pos }, pos: arg.pos } satisfies ArrowExpr;
}

type Arity = readonly [min: number, max: number];

const METHOD_ARITY: ReadonlyMap<string, Arity> = new Map(
  Object.entries({
    map: [1, 1], filter: [1, 1], find: [1, 1], some: [1, 1], every: [1, 1],
    join: [0, 1], slice: [0, 2], includes: [1, 1], indexOf: [1, 1], concat: [1, Infinity], sort: [0, 1],
    reduce: [1, 2], flatMap: [1, 1], flat: [0, 1], at: [1, 1], findIndex: [1, 1], lastIndexOf: [1, 1], reverse: [0, 0],
    split: [1, 1], trim: [0, 0], toUpperCase: [0, 0], toLowerCase: [0, 0],
    startsWith: [1, 1], endsWith: [1, 1], replace: [2, 2], replaceAll: [2, 2],
    charAt: [1, 1], substring: [1, 2], padStart: [1, 2], padEnd: [1, 2], repeat: [1, 1], trimStart: [0, 0], trimEnd: [0, 0],
    toFixed: [0, 1], toLocaleString: [0, 0], toString: [0, 1],
  } satisfies Record<MethodName, Arity>),
);

const FUNCTION_ARITY: ReadonlyMap<string, Arity> = new Map(
  Object.entries({
    round: [1, 2], fmt: [1, 2], sum: [1, 1], min: [1, Infinity], max: [1, Infinity], abs: [1, 1], Load: [1, 1],
    keys: [1, 1], values: [1, 1], entries: [1, 1], floor: [1, 1], ceil: [1, 1], sqrt: [1, 1], pow: [2, 2],
    Number: [1, 1], String: [1, 1], parseInt: [1, 2], parseFloat: [1, 1], "JSON.stringify": [1, 3], "Date.now": [0, 0],
  } satisfies Record<FunctionName, Arity>),
);

/** A capitalized call the catalog lacks, as in `Link(url)`: it renders as an Error node instead of failing the block. */
export function isUnknownComponentName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !COMPONENT_SPECS.has(name) && !ACTION_SPECS.has(name) && !FUNCTION_ARITY.has(name);
}

const ACTION_LIST = [...ACTION_SPECS].map(([name, spec]) => signature(name, spec)).join(", ");
const ARROW_ONLY =
  "arrow functions can only be declared as a named function (`share = p => ...`) or passed to a list method such as map, filter, reduce or sort";

/** The type of a value, as named in diagnostics. */
export type Kind = "null" | "boolean" | "number" | "string" | "list" | "object" | "node" | "action" | "binding";

export const DESCRIPTIONS: Record<Kind, string> = {
  null: "null",
  boolean: "a boolean",
  number: "a number",
  string: "text",
  list: "a list",
  object: "an object",
  node: "a component",
  action: "an action",
  binding: "a state binding",
};

export const EXPECTED: Record<ParamKind, string> = {
  string: "text",
  text: "text",
  number: "a number",
  boolean: "true or false",
  enum: "one of its allowed values",
  nodes: "components or text",
  list: "a list",
  series: "a list of numbers or {name: [numbers]}",
  binding: "a `$state`",
  actions: "actions",
  any: "a value",
};

const STATE_KINDS: Record<StateKind, { readonly fits: readonly Kind[]; readonly needs: string; readonly example: string }> = {
  text: { fits: ["string"], needs: "a text", example: '""' },
  number: { fits: ["number"], needs: "a number", example: "0" },
  boolean: { fits: ["boolean"], needs: "a boolean", example: "false" },
  scalar: { fits: ["string", "number", "boolean"], needs: "a text, number or boolean", example: '""' },
  list: { fits: ["list"], needs: "a list", example: "[]" },
};

/** Why `kind` cannot be bound to `param` (e.g. "`Checklist` value needs a list state, ..."), or null if it can. */
export function stateMismatch(label: string, param: ParamSpec, state: string, kind: Kind, verb: string): string | null {
  const holds = param.holds;
  if (holds === undefined || kind === "null" || STATE_KINDS[holds].fits.includes(kind)) return null;
  const { needs, example } = STATE_KINDS[holds];
  return `${label} needs ${needs} state, but \`$${state}\` ${verb} ${DESCRIPTIONS[kind]}; declare it as \`$${state} = ${example}\``;
}

/**
 * A lossless reading of a state value an input can't hold as-is, or
 * undefined when there is none: text or a number where a list is needed
 * (`"a"` → `["a"]`, `""` → `[]`), numeric text where a number is, a number or
 * boolean where text is. Models often declare `$picked = ""` for a Checklist;
 * reading it this way keeps the UI working instead of failing it.
 */
export function coerceState(holds: StateKind | undefined, value: Value): Value | undefined {
  const scalar = typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  if (holds === "list" && scalar) return value === "" ? [] : [value];
  if (holds === "number" && typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  if (holds === "text" && (typeof value === "number" || typeof value === "boolean")) return String(value);
  return undefined;
}

type StateExpr = Extract<Expr, { type: "state" }>;

/** The empty value an input starts with when its state was never declared. */
function emptyState(holds: StateKind | undefined): readonly [] | number | boolean | string {
  return holds === "list" ? [] : holds === "number" ? 0 : holds === "boolean" ? false : "";
}

function children(expr: Expr): readonly Expr[] {
  switch (expr.type) {
    case "literal":
    case "state":
    case "ident":
      return [];
    case "template":
      return expr.parts;
    case "list":
      return expr.items;
    case "object":
      return expr.entries.flatMap((entry) => (typeof entry.key === "object" && entry.key !== null ? [entry.key, entry.value] : [entry.value]));
    case "spread":
      return [expr.value];
    case "unary":
      return [expr.operand];
    case "binary":
      return [expr.left, expr.right];
    case "conditional":
      return [expr.test, expr.then, expr.else];
    case "member":
      return [expr.object];
    case "index":
      return [expr.object, expr.index];
    case "call":
      return [...expr.args, ...expr.named.map((arg) => arg.value)];
    case "method":
      return [expr.object, ...expr.args, ...expr.named.map((arg) => arg.value)];
    case "arrow":
      return [expr.body];
    case "let":
      return [expr.value, expr.body];
  }
}

/** Every `$name` passed as an input's binding, in source order, with what that input holds. */
function inputBindings(expr: Expr): { state: StateExpr; holds: StateKind | undefined }[] {
  const found: { state: StateExpr; holds: StateKind | undefined }[] = [];
  const spec = expr.type === "call" ? COMPONENT_SPECS.get(expr.name) : undefined;
  if (expr.type === "call" && spec !== undefined) {
    spec.params.forEach((param, index) => {
      if (param.kind !== "binding") return;
      const slot = expr.named.find((arg) => arg.name === param.name)?.value ?? expr.args[index];
      if (slot?.type === "state") found.push({ state: slot, holds: param.holds });
    });
  }
  for (const child of children(expr)) found.push(...inputBindings(child));
  return found;
}

/** Params whose literal arguments can be type-checked before evaluation. */
const LITERAL_KINDS: Partial<Record<ParamKind, Kind>> = { list: "list", number: "number", boolean: "boolean" };

/** The kind an expression always evaluates to, when knowable without evaluating it. */
function staticKind(expr: Expr): Kind | undefined {
  switch (expr.type) {
    case "literal":
      return expr.value === null ? "null" : (typeof expr.value as "string" | "number" | "boolean");
    case "template":
      return "string";
    case "list":
      return "list";
    case "object":
      return "object";
    case "unary":
      return expr.op === "!" ? "boolean" : "number";
    default:
      return undefined;
  }
}

function signature(name: string, spec: ComponentSpec): string {
  const params = spec.params.map(
    (param) => `${param.kind === "binding" ? "$" : ""}${param.name}${param.optional ? "?" : ""}`,
  );
  return `${name}(${params.join(", ")})`;
}

function isSpread(arg: Expr): boolean {
  return arg.type === "spread";
}

function arityText([min, max]: Arity): string {
  if (max === Infinity) return `at least ${min} argument${min === 1 ? "" : "s"}`;
  if (min === max) return `${min} argument${min === 1 ? "" : "s"}`;
  return `${min} to ${max} arguments`;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** " Did you mean `x`?" for the closest candidate within edit distance 2, else "". */
function didYouMean(name: string, candidates: Iterable<string>, render = (candidate: string) => candidate): string {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of candidates) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance < bestDistance && distance < name.length) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best === undefined ? "" : ` Did you mean \`${render(best)}\`?`;
}

interface Ref {
  readonly name: string;
  readonly pos: Pos;
}

/** Everything one top-level expression reads. */
interface Refs {
  readonly named: Ref[];
  readonly states: Ref[];
}

/** Checks parsed statements against the catalog; reports into `diagnostics`. */
export function validate(statements: readonly Statement[], diagnostics: DiagnosticList): Program {
  return new Validator(diagnostics).run(statements);
}

interface ValidatorFields {
  states: Map<string, { readonly index: number; readonly decl: Decl }>;
  named: Map<string, Decl>;
  diagnostics: DiagnosticList;
}

const Validator = defineClass(
  function (this: ValidatorFields, diagnostics: DiagnosticList): void {
    this.diagnostics = diagnostics;
    this.states = new Map<string, { readonly index: number; readonly decl: Decl }>();
    this.named = new Map<string, Decl>();
  },
  {
    run(statements: readonly Statement[]): Program {
      const stateDecls: Decl[] = [];
      const roots: Expr[] = [];
      for (const statement of statements) {
        if (statement.kind === "root") {
          roots.push(statement.value);
          continue;
        }
        this.forbidden(statement.name, statement.pos);
        const isState = statement.kind === "state";
        const previous = isState ? this.states.get(statement.name)?.decl : this.named.get(statement.name);
        if (previous !== undefined) {
          const label = isState ? `$${statement.name}` : statement.name;
          this.diagnostics.report(statement.pos, `\`${label}\` is already declared on line ${previous.pos.line}`);
        } else if (isState) {
          this.states.set(statement.name, { index: stateDecls.length, decl: statement });
          stateDecls.push(statement);
        } else {
          this.named.set(statement.name, statement);
        }
      }

      // Agents often bind an input to `$name` without declaring it; declare it empty rather than fail the block.
      const exprs = [...roots, ...[...this.named.values()].map((decl) => decl.value), ...stateDecls.map((decl) => decl.value)];
      for (const slot of exprs.flatMap(inputBindings)) {
        if (this.states.has(slot.state.name) || this.named.has(slot.state.name)) continue;
        const empty = emptyState(slot.holds);
        const { name, pos } = slot.state;
        const value: Expr = typeof empty === "object" ? { type: "list", items: [], pos } : { type: "literal", value: empty, pos };
        const decl: Decl = { name, value, pos };
        this.states.set(decl.name, { index: stateDecls.length, decl });
        stateDecls.push(decl);
        const initial = JSON.stringify(empty);
        this.diagnostics.report(
          slot.state.pos,
          `\`$${decl.name}\` was not declared, so it starts as ${initial}. Declare it first, as in \`$${decl.name} = ${initial}\`.`,
          "warning",
        );
      }

      const used = new Set<string>();
      const namedRefs = new Map<string, Refs>();
      for (const [name, decl] of this.named) {
        const refs = this.declRefs(decl);
        namedRefs.set(name, refs);
        for (const ref of refs.named) if (ref.name !== name) used.add(ref.name);
      }
      for (const root of roots) for (const ref of this.refs(root).named) used.add(ref.name);

      const rootDecl = this.named.get("root");
      if (roots.length === 0) {
        if (rootDecl === undefined) {
          this.diagnostics.report(
            { line: 1, column: 1 },
            "Nothing to render: add a bare component expression such as Card(...)",
          );
        } else {
          roots.push({ type: "ident", name: "root", pos: rootDecl.pos });
          used.add("root");
        }
      }

      this.checkCycles(namedRefs);
      const statesOf = this.transitiveStates(namedRefs);
      stateDecls.forEach((decl, index) => {
        const refs = this.refs(decl.value);
        for (const ref of refs.named) used.add(ref.name);
        for (const ref of refs.states) {
          const target = this.states.get(ref.name);
          if (target === undefined || target.index < index) continue;
          this.diagnostics.report(
            ref.pos,
            target.index === index
              ? `\`$${decl.name}\` cannot use itself in its initial value`
              : `\`$${ref.name}\` is declared after \`$${decl.name}\`; initial values can only use earlier state`,
          );
        }
        for (const ref of refs.named) {
          const late = [...statesOf(ref.name)].find((name) => (this.states.get(name)?.index ?? -1) >= index);
          if (late !== undefined) {
            this.diagnostics.report(
              ref.pos,
              `\`${ref.name}\` reads \`$${late}\`, which is not initialized before \`$${decl.name}\``,
            );
          }
        }
      });

      for (const [name, decl] of this.named) {
        if (!used.has(name)) this.diagnostics.report(decl.pos, `\`${name}\` is never used`, "warning");
      }
      return { states: stateDecls, named: this.named, roots };
    },

    refs(expr: Expr): Refs {
      const refs: Refs = { named: [], states: [] };
      this.check(expr, [], refs);
      return refs;
    },

    /** A named value's refs; a named function (`share = p => ...`) is checked with its parameters in scope. */
    declRefs(decl: Decl): Refs {
      if (decl.value.type !== "arrow") return this.refs(decl.value);
      if (COMPONENT_SPECS.has(decl.name) || ACTION_SPECS.has(decl.name) || FUNCTION_ARITY.has(decl.name)) {
        this.diagnostics.report(decl.pos, `\`${decl.name}\` is a built-in name; give your function another name`);
      }
      const refs: Refs = { named: [], states: [] };
      this.check(decl.value.body, decl.value.params, refs);
      return refs;
    },

    checkCycles(namedRefs: ReadonlyMap<string, Refs>): void {
      const status = new Map<string, "visiting" | "done">();
      const path: string[] = [];
      const visit = (name: string): void => {
        const current = status.get(name);
        if (current === "done") return;
        if (current === "visiting") {
          const cycle = [...path.slice(path.indexOf(name)), name];
          this.diagnostics.report(this.named.get(name)!.pos, `\`${name}\` depends on itself: ${cycle.join(" → ")}`);
          return;
        }
        status.set(name, "visiting");
        path.push(name);
        for (const ref of namedRefs.get(name)?.named ?? []) if (this.named.has(ref.name)) visit(ref.name);
        path.pop();
        status.set(name, "done");
      };
      for (const name of this.named.keys()) visit(name);
    },

    /** State names each named value reads, directly or through other named values. */
    transitiveStates(namedRefs: ReadonlyMap<string, Refs>): (name: string) => ReadonlySet<string> {
      const memo = new Map<string, Set<string>>();
      const statesOf = (name: string): ReadonlySet<string> => {
        const cached = memo.get(name);
        if (cached !== undefined) return cached;
        const result = new Set<string>();
        memo.set(name, result); // cycles were reported; this stops the recursion
        const refs = namedRefs.get(name);
        for (const ref of refs?.states ?? []) result.add(ref.name);
        for (const ref of refs?.named ?? []) for (const state of statesOf(ref.name)) result.add(state);
        return result;
      };
      return statesOf;
    },

    forbidden(name: string, pos: Pos): void {
      if ((FORBIDDEN_PROPERTIES as readonly string[]).includes(name)) {
        this.diagnostics.report(pos, `\`${name}\` is not accessible`);
      }
    },

    check(expr: Expr, params: readonly string[], refs: Refs): void {
      switch (expr.type) {
        case "literal":
          return;
        case "template":
          for (const part of expr.parts) this.check(part, params, refs);
          return;
        case "state":
          if (!this.states.has(expr.name)) {
            const hint = this.named.has(expr.name)
              ? ` \`${expr.name}\` is a named value; write it without \`$\`.`
              : didYouMean(expr.name, this.states.keys(), (name) => `$${name}`) ||
                ` Declare it first, as in \`$${expr.name} = 0\`.`;
            this.diagnostics.report(expr.pos, `unknown state \`$${expr.name}\`.${hint}`);
          }
          refs.states.push(expr);
          return;
        case "ident":
          if (params.includes(expr.name)) return;
          if (this.named.has(expr.name)) {
            if (this.named.get(expr.name)!.value.type === "arrow") {
              this.diagnostics.report(expr.pos, `\`${expr.name}\` is a function; call it, as in \`${expr.name}(...)\``);
            }
            refs.named.push(expr);
            return;
          }
          this.diagnostics.report(expr.pos, this.unknownName(expr.name, params));
          return;
        case "list":
          for (const item of expr.items) this.check(item, params, refs);
          return;
        case "object":
          for (const entry of expr.entries) {
            if (typeof entry.key === "string") this.forbidden(entry.key, entry.pos);
            else if (entry.key !== null) this.check(entry.key, params, refs);
            this.check(entry.value, params, refs);
          }
          return;
        case "spread":
          this.check(expr.value, params, refs);
          return;
        case "let":
          this.check(expr.value, params, refs);
          this.check(expr.body, [...params, expr.name], refs);
          return;
        case "unary":
          this.check(expr.operand, params, refs);
          return;
        case "binary":
          this.check(expr.left, params, refs);
          this.check(expr.right, params, refs);
          return;
        case "conditional":
          this.check(expr.test, params, refs);
          this.check(expr.then, params, refs);
          this.check(expr.else, params, refs);
          return;
        case "member":
          this.forbidden(expr.name, expr.pos);
          this.check(expr.object, params, refs);
          return;
        case "index":
          if (expr.index.type === "literal" && typeof expr.index.value === "string") {
            this.forbidden(expr.index.value, expr.index.pos);
          }
          this.check(expr.object, params, refs);
          this.check(expr.index, params, refs);
          return;
        case "arrow":
          this.diagnostics.report(expr.pos, ARROW_ONLY);
          this.check(expr.body, [...params, ...expr.params], refs);
          return;
        case "method":
          this.method(expr, params, refs);
          return;
        case "call":
          this.call(expr, params, refs);
          return;
      }
    },

    unknownName(name: string, params: readonly string[]): string {
      if (this.states.has(name)) return `\`${name}\` is not defined. Did you mean \`$${name}\`?`;
      if (COMPONENT_SPECS.has(name) || ACTION_SPECS.has(name) || FUNCTION_ARITY.has(name)) {
        return `\`${name}\` must be called, as in \`${name}(...)\``;
      }
      const hint = didYouMean(name, [...params, ...this.named.keys()]);
      return `\`${name}\` is not defined.${hint || ` Declare it first, as in \`${name} = ...\`.`}`;
    },

    method(expr: Extract<Expr, { type: "method" }>, params: readonly string[], refs: Refs): void {
      this.check(expr.object, params, refs);
      for (const arg of expr.named) {
        this.diagnostics.report(arg.pos, "methods take positional arguments only");
        this.check(arg.value, params, refs);
      }
      const arity = METHOD_ARITY.get(expr.name);
      if (arity === undefined) {
        const hint = didYouMean(expr.name, METHOD_ARITY.keys(), (name) => `.${name}()`);
        this.diagnostics.report(
          expr.pos,
          `\`.${expr.name}()\` is not an allowed method.${hint} Lists: ${METHODS.list.join(", ")}. Text: ${METHODS.string.join(", ")}. Numbers: ${METHODS.number.join(", ")}.`,
        );
      } else if (!expr.args.some(isSpread) && (expr.args.length < arity[0] || expr.args.length > arity[1])) {
        this.diagnostics.report(expr.pos, `\`.${expr.name}()\` takes ${arityText(arity)}`);
      }
      const [written, ...rest] = expr.args;
      const passes = FUNCTION_PARAMS.get(expr.name);
      const first = written !== undefined && passes !== undefined ? functionArg(written, this.named, expr.name, params) : written;
      if (passes !== undefined && first !== undefined) {
        if (first.type !== "arrow") {
          const example =
            expr.name === "sort" ? "(a, b) => a.price - b.price" : expr.name === "reduce" ? "(total, x) => total + x.price, 0" : "x => x.price";
          this.diagnostics.report(first.pos, `\`.${expr.name}()\` takes a function, as in \`${example}\``);
          this.check(first, params, refs);
        } else {
          if (first.params.length > passes.length) {
            this.diagnostics.report(
              first.pos,
              `\`.${expr.name}()\` passes (${passes.join(", ")}); use at most ${passes.length} parameters`,
            );
          }
          this.check(first.body, [...params, ...first.params], refs);
        }
      } else if (first !== undefined) {
        this.check(first, params, refs);
      }
      for (const arg of rest) this.check(arg, params, refs);
    },

    call(expr: CallExpr, params: readonly string[], refs: Refs): void {
      const spec = COMPONENT_SPECS.get(expr.name) ?? ACTION_SPECS.get(expr.name);
      const own = this.named.get(expr.name)?.value;
      if (spec !== undefined) {
        this.catalogCall(expr, spec);
      } else if (own?.type === "arrow" && !params.includes(expr.name)) {
        if (expr.named.length > 0) {
          this.diagnostics.report(expr.named[0].pos, `\`${expr.name}\` takes positional arguments only`);
        }
        if (!expr.args.some(isSpread) && expr.args.length > own.params.length) {
          const count = own.params.length;
          this.diagnostics.report(expr.pos, `\`${expr.name}\` takes ${count} argument${count === 1 ? "" : "s"}`);
        }
        refs.named.push(expr);
      } else {
        const arity = FUNCTION_ARITY.get(expr.name);
        if (arity === undefined) {
          // An unknown component renders as an inline Error node, so the rest of the block still shows.
          const component = this.unknownComponent(expr.name, params);
          this.diagnostics.report(expr.pos, this.unknownCallee(expr.name, params), component ? "warning" : "error");
        } else {
          if (expr.named.length > 0) {
            this.diagnostics.report(expr.named[0].pos, `\`${expr.name}\` takes positional arguments only`);
          }
          if (!expr.args.some(isSpread) && (expr.args.length < arity[0] || expr.args.length > arity[1])) {
            this.diagnostics.report(expr.pos, `\`${expr.name}\` takes ${arityText(arity)}: ${FUNCTIONS[expr.name as FunctionName]}`);
          } else if (expr.name === "Load") {
            this.literalPath(expr.args[0], "Load");
          }
        }
      }
      for (const arg of expr.args) this.check(arg, params, refs);
      for (const arg of expr.named) this.check(arg.value, params, refs);
    },

    unknownComponent(name: string, params: readonly string[]): boolean {
      return isUnknownComponentName(name) && !this.named.has(name) && !params.includes(name) && !this.states.has(name);
    },

    unknownCallee(name: string, params: readonly string[]): string {
      if (this.named.has(name) || params.includes(name) || this.states.has(name)) {
        return `\`${name}\` is a value and cannot be called; only components, actions and functions can`;
      }
      const isFunctionLike = name[0] === name[0].toLowerCase();
      const candidates = [...COMPONENT_SPECS.keys(), ...ACTION_SPECS.keys(), ...FUNCTION_ARITY.keys()];
      const fallback = isFunctionLike
        ? ` Functions: ${[...FUNCTION_ARITY.keys()].join(", ")}.`
        : ` Components: ${[...COMPONENT_SPECS.keys()].join(", ")}.`;
      return `\`${name}\` is not a component, action or function.${didYouMean(name, candidates) || fallback}`;
    },

    /** The host fetches files before evaluating, so the path must be readable from the source alone. */
    literalPath(arg: Expr, owner: "Load" | "Snippet"): void {
      const path = loadPath(arg);
      if (path === null) {
        const usage =
          owner === "Load"
            ? '`Load` takes a plain string path, as in Load("data/sales.csv")'
            : '`Snippet` takes its path as a literal string, as in Snippet("src/app.ts", 10, 40)';
        this.diagnostics.report(
          arg.pos,
          `${usage}; the file is read before the UI runs, so the path cannot be computed or use \`\${}\``,
        );
      } else if (path.trim() === "") {
        this.diagnostics.report(arg.pos, `\`${owner}\` needs a file path`);
      }
    },

    /** Maps arguments onto catalog params and checks what is knowable before evaluation. */
    catalogCall(expr: CallExpr, spec: ComponentSpec): void {
      const sig = signature(expr.name, spec);
      for (const arg of expr.args.filter(isSpread)) {
        this.diagnostics.report(arg.pos, `\`...\` cannot spread into ${expr.name}; pass the list or object itself`);
      }
      const slots: (Expr | undefined)[] = spec.params.map((_, index) => expr.args[index]);
      if (expr.args.length > spec.params.length) {
        this.diagnostics.report(expr.args[spec.params.length].pos, `too many arguments: ${sig}`);
      }
      for (const arg of expr.named) {
        const index = spec.params.findIndex((param) => param.name === arg.name);
        if (index < 0) {
          const hint = didYouMean(arg.name, spec.params.map((param) => param.name));
          this.diagnostics.report(arg.pos, `\`${expr.name}\` has no parameter \`${arg.name}\`.${hint} ${sig}`);
        } else if (slots[index] !== undefined) {
          this.diagnostics.report(arg.pos, `\`${arg.name}\` is given twice: ${sig}`);
        } else {
          slots[index] = arg.value;
        }
      }
      spec.params.forEach((param, index) => {
        const slot = slots[index];
        if (slot === undefined) {
          if (!param.optional) this.diagnostics.report(expr.pos, `\`${expr.name}\` is missing \`${param.name}\`: ${sig}`);
        } else {
          this.checkParam(expr.name, param, slot);
        }
      });
    },

    checkParam(owner: string, param: ParamSpec, slot: Expr): void {
      const label = `\`${owner}\` ${param.name}`;
      if (owner === "Snippet" && param.name === "path") this.literalPath(slot, "Snippet");
      // A bare state name (`plan` for `$plan`) is already reported with a `$` suggestion.
      const isBareState = slot.type === "ident" && this.states.has(slot.name);
      if (param.kind === "binding" && slot.type !== "state" && !isBareState) {
        this.diagnostics.report(slot.pos, `${label} must be a state variable written as \`$name\``);
      }
      if (param.kind === "binding" && slot.type === "state") {
        const initial = this.states.get(slot.name)?.decl.value;
        const kind = initial === undefined ? undefined : staticKind(initial);
        const mismatch = kind === undefined ? null : stateMismatch(label, param, slot.name, kind, "starts as");
        // A literal the input can read losslessly is only worth a warning.
        const coercible = initial?.type === "literal" && coerceState(param.holds, initial.value) !== undefined;
        if (mismatch !== null) this.diagnostics.report(slot.pos, mismatch, coercible ? "warning" : "error");
      }
      const wanted = LITERAL_KINDS[param.kind];
      const got = staticKind(slot);
      if (wanted !== undefined && got !== undefined && got !== wanted && !(got === "null" && (param.optional || param.nullable))) {
        this.diagnostics.report(slot.pos, `${label} needs ${EXPECTED[param.kind]}, got ${DESCRIPTIONS[got]}`);
      }
      if (param.kind === "enum" && slot.type === "literal" && !(slot.value === null && param.optional)) {
        const values = param.values ?? [];
        if (typeof slot.value !== "string" || !values.includes(slot.value)) {
          this.diagnostics.report(slot.pos, `${label} must be one of ${values.join(", ")}; got ${JSON.stringify(slot.value)}`);
        }
      }
      if (param.kind === "actions") {
        for (const item of slot.type === "list" ? slot.items : [slot]) {
          let got: string | undefined;
          if (item.type === "call" && (COMPONENT_SPECS.has(item.name) || FUNCTION_ARITY.has(item.name))) {
            got = `\`${item.name}(...)\``;
          } else if (item.type === "literal" && item.value !== null) {
            got = JSON.stringify(item.value);
          }
          if (got !== undefined) {
            this.diagnostics.report(item.pos, `${label} takes actions: ${ACTION_LIST}; got ${got}`);
          }
        }
      }
    },
  },
);
type Validator = InstanceType<typeof Validator>;
