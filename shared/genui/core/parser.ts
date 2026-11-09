import type { BinaryOperator, Expr, NamedArg, Statement } from "./ast";
import type { DiagnosticList, Pos } from "./diagnostics";
import type { Token } from "./lexer";
import { defineClass } from "./define-class";

const PRECEDENCE: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "==": 4, "!=": 4, "===": 4, "!==": 4,
  "<": 5, "<=": 5, ">": 5, ">=": 5, in: 5,
  "+": 6, "-": 6,
  "*": 7, "/": 7, "%": 7,
};

const KEYWORDS: Record<string, true | false | null> = { true: true, false: false, null: null };

/**
 * `Math.round(x)` and `Object.entries(o)` are how models write the built-ins;
 * they parse as the plain calls `round(x)` and `entries(o)`. `JSON.stringify`
 * and `Date.now` keep their dotted names, which no written name can shadow.
 */
const NAMESPACES: Record<string, string> = { Math: "", Object: "", JSON: "JSON.", Date: "Date." };

const BLOCK_WORDS: Record<string, true> = { return: true, const: true, let: true, var: true };

/** A parameter or `const` target: a name, or `{a, b: c}` / `[a, b]` destructuring with optional `= fallback`s. */
type Pattern =
  | { readonly kind: "name"; readonly name: string; readonly pos: Pos }
  | {
      readonly kind: "object";
      readonly props: readonly { readonly key: string; readonly target: Pattern; readonly fallback: Expr | null }[];
      readonly pos: Pos;
    }
  | {
      readonly kind: "array";
      readonly items: readonly ({ readonly target: Pattern; readonly fallback: Expr | null } | null)[];
      readonly pos: Pos;
    };

/** AST depth beyond this is rejected so later tree walks cannot overflow the stack. */
const MAX_NESTING = 100;

interface ParseErrorFields {
  pos: Pos;
  message: string;
}

const ParseError = defineClass(
  function (this: ParseErrorFields, pos: Pos, message: string): void {
    this.pos = pos;
    this.message = message;
  },
  {

  },
);
type ParseError = InstanceType<typeof ParseError>;

function describe(token: Token): string {
  switch (token.t) {
    case "num":
      return `number ${token.value}`;
    case "str":
      return "a string";
    case "tpl":
      return "a template string";
    case "ident":
      return `\`${token.value}\``;
    case "state":
      return `\`$${token.value}\``;
    case "punct":
      return `\`${token.value}\``;
    case "sep":
      return token.value === ";" ? "`;`" : "end of line";
    case "eof":
      return "end of input";
  }
}

/** Parses all statements; syntax errors are reported and their statement skipped. */
export function parse(tokens: readonly Token[], diagnostics: DiagnosticList): Statement[] {
  const parser = new Parser(tokens, 0);
  const statements: Statement[] = [];
  for (;;) {
    while (parser.peek().t === "sep") parser.i++;
    if (parser.peek().t === "eof") return statements;
    try {
      statements.push(parser.statement());
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      diagnostics.report(error.pos, error.message);
      while (parser.peek().t !== "sep" && parser.peek().t !== "eof") parser.i++;
    }
  }
}

interface ParserFields {
  i: number;
  tokens: readonly Token[];
  depth: number;
  /** Counter for the names destructuring binds its intermediate values to. */
  hidden: number;
}

const Parser = defineClass(
  function (this: ParserFields, tokens: readonly Token[], depth: number): void {
    this.tokens = tokens;
    this.depth = depth;
    this.i = 0;
    this.hidden = 0;
  },
  {
    peek(offset = 0): Token {
      return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
    },

    isPunct(value: string, offset = 0): boolean {
      const token = this.peek(offset);
      return token.t === "punct" && token.value === value;
    },

    eat(value: string): boolean {
      if (!this.isPunct(value)) return false;
      this.i++;
      return true;
    },

    /** Consumes the closer of `open`, or fails naming what else was acceptable. */
    close(closer: string, open: Token, alternatives = ""): void {
      if (this.eat(closer)) return;
      const opener = open.t === "punct" ? open.value : "(";
      throw new ParseError(
        this.peek(),
        `expected ${alternatives}\`${closer}\` to close \`${opener}\` from ${open.line}:${open.column}, found ${describe(this.peek())}`,
      );
    },

    ident(what: string): Pos & { readonly value: string } {
      const token = this.peek();
      if (token.t !== "ident") throw new ParseError(token, `expected ${what}, found ${describe(token)}`);
      this.i++;
      return token;
    },

    statement(): Statement {
      this.depth = 0;
      const first = this.peek();
      let statement: Statement;
      if ((first.t === "state" || first.t === "ident") && this.isPunct("=", 1)) {
        if (first.t === "ident" && Object.hasOwn(KEYWORDS, first.value)) {
          throw new ParseError(first, `\`${first.value}\` is a keyword and cannot be assigned`);
        }
        this.i += 2;
        const kind = first.t === "state" ? "state" : "named";
        statement = { kind, name: first.value, value: this.expr(), pos: first };
      } else {
        statement = { kind: "root", value: this.expr() };
      }
      const next = this.peek();
      if (next.t !== "sep" && next.t !== "eof") {
        throw new ParseError(
          next,
          `expected a new line or \`;\` after the statement, found ${describe(next)}; wrap multi-line expressions in brackets`,
        );
      }
      return statement;
    },

    /** Counts one level of AST nesting; callers restore `depth` when their subtree is done. */
    nest(at: Token): void {
      if (++this.depth > MAX_NESTING) throw new ParseError(at, "expression is nested too deeply; split it into named values");
    },

    expr(): Expr {
      const saved = this.depth;
      this.nest(this.peek());
      const expr = this.isArrowStart() ? this.arrow() : this.conditional();
      this.depth = saved;
      return expr;
    },

    /** `x =>`, or a bracketed group followed by `=>`. */
    isArrowStart(): boolean {
      if (this.peek().t === "ident") return this.isPunct("=>", 1);
      if (!this.isPunct("(")) return false;
      let depth = 0;
      for (let offset = 0; ; offset++) {
        const token = this.peek(offset);
        if (token.t === "eof" || token.t === "sep") return false;
        if (token.t !== "punct") continue;
        if (token.value === "(" || token.value === "[" || token.value === "{") depth++;
        if ((token.value === ")" || token.value === "]" || token.value === "}") && --depth === 0) {
          return this.isPunct("=>", offset + 1);
        }
      }
    },

    arrow(): Expr {
      const start = this.peek();
      const patterns: Pattern[] = [];
      if (this.eat("(")) {
        while (!this.eat(")")) {
          patterns.push(this.pattern());
          if (!this.eat(",")) {
            this.close(")", start, "`,` or ");
            break;
          }
        }
      } else {
        patterns.push(this.pattern());
      }
      this.i++; // `=>`, guaranteed by isArrowStart
      let body = this.isBlockStart() ? this.block() : this.expr();
      const params = patterns.map((pattern, index) => (pattern.kind === "name" ? pattern.name : `#p${index}`));
      for (let index = patterns.length - 1; index >= 0; index--) {
        if (patterns[index].kind !== "name") body = this.bind(patterns[index], { type: "ident", name: params[index], pos: start }, body);
      }
      return { type: "arrow", params, body, pos: start };
    },

    pattern(): Pattern {
      const open = this.peek();
      if (this.eat("{")) {
        const props: { key: string; target: Pattern; fallback: Expr | null }[] = [];
        while (!this.eat("}")) {
          const key = this.peek();
          if (key.t !== "ident" && key.t !== "str") {
            throw new ParseError(key, `expected a property name to destructure, found ${describe(key)}`);
          }
          this.i++;
          const target: Pattern = this.eat(":") ? this.pattern() : this.patternName(key);
          props.push({ key: key.value, target, fallback: this.eat("=") ? this.expr() : null });
          if (!this.eat(",")) {
            this.close("}", open, "`,` or ");
            break;
          }
        }
        return { kind: "object", props, pos: open };
      }
      if (this.eat("[")) {
        const items: ({ target: Pattern; fallback: Expr | null } | null)[] = [];
        while (!this.eat("]")) {
          if (this.eat(",")) {
            items.push(null);
            continue;
          }
          const target = this.pattern();
          items.push({ target, fallback: this.eat("=") ? this.expr() : null });
          if (!this.eat(",")) {
            this.close("]", open, "`,` or ");
            break;
          }
        }
        return { kind: "array", items, pos: open };
      }
      return this.patternName(this.ident("a parameter name"));
    },

    patternName(token: Pos & { readonly value: string }): Pattern {
      if (Object.hasOwn(KEYWORDS, token.value) || Object.hasOwn(BLOCK_WORDS, token.value)) {
        throw new ParseError(token, `\`${token.value}\` cannot be a parameter name`);
      }
      return { kind: "name", name: token.value, pos: token };
    },

    /** `body` with `pattern`'s names bound from `source`; a missing value is null, or its fallback. */
    bind(pattern: Pattern, source: Expr, body: Expr): Expr {
      if (pattern.kind === "name") return { type: "let", name: pattern.name, value: source, body, pos: pattern.pos };
      const holder = `#d${this.hidden++}`;
      const from: Expr = { type: "ident", name: holder, pos: pattern.pos };
      const parts =
        pattern.kind === "object"
          ? pattern.props.map((prop) => ({ ...prop, key: prop.key as string | number }))
          : pattern.items.flatMap((item, index) => (item === null ? [] : [{ ...item, key: index as string | number }]));
      let inner = body;
      for (let index = parts.length - 1; index >= 0; index--) {
        const { key, target, fallback } = parts[index];
        let value: Expr = { type: "index", object: from, index: { type: "literal", value: key, pos: pattern.pos }, pos: pattern.pos };
        if (fallback !== null) value = { type: "binary", op: "??", left: value, right: fallback, pos: pattern.pos };
        inner = this.bind(target, value, inner);
      }
      return { type: "let", name: holder, value: source, body: inner, pos: pattern.pos };
    },

    isBlockStart(): boolean {
      const next = this.peek(1);
      // `if` is no block word, but a body starting with it is meant as one; block() explains what is allowed.
      return this.isPunct("{") && next.t === "ident" && (Object.hasOwn(BLOCK_WORDS, next.value) || next.value === "if");
    },

    /** `{ const a = ...; return ... }`: declarations, then one return. */
    block(): Expr {
      const open = this.tokens[this.i++];
      const decls: { pattern: Pattern; value: Expr }[] = [];
      for (;;) {
        while (this.peek().t === "sep") this.i++;
        const word = this.peek();
        if (word.t === "ident" && (word.value === "const" || word.value === "let" || word.value === "var")) {
          this.i++;
          const pattern = this.pattern();
          if (!this.eat("=")) throw new ParseError(this.peek(), `expected \`=\` after the \`${word.value}\` name, found ${describe(this.peek())}`);
          decls.push({ pattern, value: this.expr() });
          continue;
        }
        if (word.t === "ident" && word.value === "return") {
          this.i++;
          let body = this.expr();
          while (this.peek().t === "sep") this.i++;
          this.close("}", open);
          for (let index = decls.length - 1; index >= 0; index--) body = this.bind(decls[index].pattern, decls[index].value, body);
          return body;
        }
        throw new ParseError(
          word,
          `a \`{ }\` function body holds \`const name = ...\` lines and one \`return ...\`; found ${describe(word)}. Use \`?:\` for conditions`,
        );
      }
    },

    conditional(): Expr {
      const test = this.binary(1);
      const question = this.peek();
      if (!this.eat("?")) return test;
      const then = this.expr();
      if (!this.eat(":")) {
        throw new ParseError(this.peek(), `expected \`:\` for the \`?\` at ${question.line}:${question.column}, found ${describe(this.peek())}`);
      }
      return { type: "conditional", test, then, else: this.expr(), pos: question };
    },

    binary(minPrecedence: number): Expr {
      const saved = this.depth;
      let left = this.unary();
      for (;;) {
        const token = this.peek();
        const op = token.t === "punct" || (token.t === "ident" && token.value === "in") ? token.value : null;
        if (op === null || !Object.hasOwn(PRECEDENCE, op)) break;
        const precedence = PRECEDENCE[op];
        if (precedence < minPrecedence) break;
        this.nest(token);
        this.i++;
        const right = this.binary(precedence + 1);
        left = { type: "binary", op: op as BinaryOperator, left, right, pos: token };
      }
      this.depth = saved;
      return left;
    },

    unary(): Expr {
      const saved = this.depth;
      const operators: Token[] = [];
      while (this.isPunct("!") || this.isPunct("-") || this.isTypeof()) {
        this.nest(this.peek());
        operators.push(this.tokens[this.i++]);
      }
      let expr = this.postfix();
      // `**` binds tighter than a prefix operator and associates to the right,
      // as in maths and Python: `-a ** b` is `-(a ** b)`, `a ** b ** c` is `a ** (b ** c)`.
      if (this.isPunct("**")) {
        const token = this.peek();
        this.nest(token);
        this.i++;
        expr = { type: "binary", op: "**", left: expr, right: this.unary(), pos: token };
      }
      for (let k = operators.length - 1; k >= 0; k--) {
        const token = operators[k];
        const op = token.t === "ident" ? "typeof" : token.t === "punct" && token.value === "!" ? "!" : "-";
        expr = { type: "unary", op, operand: expr, pos: token };
      }
      this.depth = saved;
      return expr;
    },

    /** `typeof` followed by something that starts an expression. */
    isTypeof(): boolean {
      const token = this.peek();
      if (token.t !== "ident" || token.value !== "typeof") return false;
      const next = this.peek(1);
      if (next.t === "punct") return ["(", "[", "{", "!", "-"].includes(next.value);
      return next.t !== "sep" && next.t !== "eof";
    },

    postfix(): Expr {
      let expr = this.primary();
      // Reading a property of null gives null already; after a `?.`, so does calling a method on it.
      let optional = false;
      for (;;) {
        if (this.isPunct(".") || this.isPunct("?.") || this.isPunct("[") || this.isPunct("(")) this.nest(this.peek());
        if (this.eat("?.")) {
          optional = true;
          if (!this.isPunct("[")) {
            expr = this.property(expr, optional);
            continue;
          }
        } else if (this.eat(".")) {
          expr = this.property(expr, optional);
          continue;
        }
        if (this.isPunct("[")) {
          const open = this.tokens[this.i++];
          const index = this.expr();
          this.close("]", open);
          expr = { type: "index", object: expr, index, pos: open };
        } else if (this.isPunct("(")) {
          if (expr.type !== "ident") {
            throw new ParseError(this.peek(), "only components, actions, functions and methods can be called");
          }
          expr = { type: "call", name: expr.name, ...this.args(), pos: expr.pos };
        } else {
          return expr;
        }
      }
    },

    /** `.name` or `.name(...)` after `object`. */
    property(object: Expr, optional: boolean): Expr {
      const name = this.ident("a property or method name after `.`");
      if (!this.isPunct("(")) return { type: "member", object, name: name.value, pos: name };
      if (object.type === "ident" && Object.hasOwn(NAMESPACES, object.name)) {
        return { type: "call", name: NAMESPACES[object.name] + name.value, ...this.args(), pos: name };
      }
      return { type: "method", object, name: name.value, ...this.args(), optional, pos: name };
    },

    /** An expression, or `...expr` where a list item or argument may spread. */
    item(): Expr {
      const token = this.peek();
      if (!this.eat("...")) return this.expr();
      return { type: "spread", value: this.expr(), pos: token };
    },

    args(): { args: Expr[]; named: NamedArg[] } {
      const open = this.tokens[this.i++];
      const args: Expr[] = [];
      const named: NamedArg[] = [];
      while (!this.eat(")")) {
        const token = this.peek();
        if (token.t === "ident" && this.isPunct(":", 1)) {
          this.i += 2;
          named.push({ name: token.value, value: this.expr(), pos: token });
        } else {
          if (named.length > 0) {
            throw new ParseError(token, "positional arguments must come before named ones");
          }
          args.push(this.item());
        }
        if (!this.eat(",")) {
          this.close(")", open, "`,` or ");
          break;
        }
      }
      return { args, named };
    },

    primary(): Expr {
      const token = this.peek();
      switch (token.t) {
        case "num":
        case "str":
          this.i++;
          return { type: "literal", value: token.value, pos: token };
        case "tpl": {
          this.i++;
          const parts = token.parts.map((tokens) => {
            const sub = new Parser(tokens, this.depth);
            const part = sub.expr();
            const end = sub.peek();
            if (end.t !== "eof") {
              throw new ParseError(end, `expected \`}\` to end the template expression, found ${describe(end)}`);
            }
            return part;
          });
          return { type: "template", quasis: token.quasis, parts, pos: token };
        }
        case "ident":
          this.i++;
          if (Object.hasOwn(KEYWORDS, token.value)) return { type: "literal", value: KEYWORDS[token.value], pos: token };
          return { type: "ident", name: token.value, pos: token };
        case "state":
          this.i++;
          return { type: "state", name: token.value, pos: token };
        case "punct":
          if (token.value === "(") {
            this.i++;
            const inner = this.expr();
            this.close(")", token);
            return inner;
          }
          if (token.value === "[") {
            this.i++;
            const items: Expr[] = [];
            while (!this.eat("]")) {
              items.push(this.item());
              if (!this.eat(",")) {
                this.close("]", token, "`,` or ");
                break;
              }
            }
            return { type: "list", items, pos: token };
          }
          if (token.value === "{") return this.object(token);
          break;
      }
      throw new ParseError(token, `expected an expression, found ${describe(token)}`);
    },

    object(open: Token): Expr {
      this.i++;
      const entries: { key: string | Expr | null; value: Expr; pos: Pos }[] = [];
      while (!this.eat("}")) {
        const key = this.peek();
        if (this.eat("...")) {
          entries.push({ key: null, value: this.expr(), pos: key });
          if (!this.eat(",")) {
            this.close("}", open, "`,` or ");
            break;
          }
          continue;
        }
        if (this.eat("[")) {
          const computed = this.expr();
          this.close("]", key);
          if (!this.eat(":")) throw new ParseError(this.peek(), `expected \`:\` after the object key, found ${describe(this.peek())}`);
          entries.push({ key: computed, value: this.expr(), pos: key });
          if (!this.eat(",")) {
            this.close("}", open, "`,` or ");
            break;
          }
          continue;
        }
        if (key.t !== "ident" && key.t !== "str") {
          throw new ParseError(key, `expected an object key (a name, a string or [expression]), found ${describe(key)}`);
        }
        this.i++;
        // `{name}` is `{name: name}`.
        if (key.t === "ident" && (this.isPunct(",") || this.isPunct("}"))) {
          entries.push({ key: key.value, value: { type: "ident", name: key.value, pos: key }, pos: key });
          if (!this.eat(",")) {
            this.close("}", open, "`,` or ");
            break;
          }
          continue;
        }
        // `{Good for: …}`: models write labels as bare words; nothing else may follow a key, so read them as one.
        let name = key.value;
        if (key.t === "ident") {
          for (let next = this.peek(); next.t === "ident" || next.t === "num"; next = this.peek()) {
            name += ` ${next.value}`;
            this.i++;
          }
        }
        if (!this.eat(":")) throw new ParseError(this.peek(), `expected \`:\` after the object key, found ${describe(this.peek())}`);
        entries.push({ key: name, value: this.expr(), pos: key });
        if (!this.eat(",")) {
          this.close("}", open, "`,` or ");
          break;
        }
      }
      return { type: "object", entries, pos: open };
    },
  },
);
type Parser = InstanceType<typeof Parser>;
