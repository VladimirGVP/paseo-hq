// Modified by GNATOVSKIE for integration into Paseo HQ, 2026-11-10.
import { describe, expect, it } from "vitest";
import { compile, dataKey, evaluate, initialState } from "./core";

// JavaScript that agents write without thinking; each must compile and give the value JavaScript gives.
const PRELUDE = [
  'xs = [{n: "a", v: 3, tags: ["t", "u"]}, {n: "b", v: 1, tags: []}]',
  "o = {a: 1, b: 2}",
  's = "Hello world"',
].join("\n");

const CASES: Record<string, [source: string, expected: string]> = {
  // list methods
  reduce: ["xs.reduce((t, x) => t + x.v, 0)", "4"],
  "reduce without a start": ["[1, 2, 3].reduce((a, b) => a + b)", "6"],
  flatMap: ['xs.flatMap(x => x.tags).join("|")', "t|u"],
  flat: ['[[1], [2, [3]]].flat().length', "3"],
  at: ["xs.at(-1).n", "b"],
  findIndex: ["xs.findIndex(x => x.v == 1)", "1"],
  lastIndexOf: ["[1, 2, 1].lastIndexOf(1)", "2"],
  reverse: ['[1, 2].reverse().join("")', "21"],
  "reverse copies": ['[1, 2].reverse().concat(xs.map(x => x.n)).join("")', "21ab"],
  // text and number methods
  padStart: ['"5".padStart(2, "0")', "05"],
  padEnd: ['"ab".padEnd(4, ".")', "ab.."],
  substring: ["s.substring(0, 5)", "Hello"],
  charAt: ["s.charAt(1)", "e"],
  repeat: ['"=".repeat(3)', "==="],
  trimStart: ['" a ".trimStart() + "|"', "a |"],
  trimEnd: ['"|" + " a ".trimEnd()', "| a"],
  "indexOf on text": ['s.indexOf("w")', "6"],
  "lastIndexOf on text": ['s.lastIndexOf("o")', "7"],
  "at on text": ["s.at(-1)", "d"],
  "number toLocaleString": ["(1234567.891).toLocaleString()", "1,234,567.891"],
  toFixed: ["(1/3).toFixed(2)", "0.33"],
  // conversion and globals
  Number: ['Number("3") + 1', "4"],
  "Number of grouped text": ['Number("1,234")', "1234"],
  "Number of junk": ['Number("x") ?? "none"', "none"],
  String: ["String(3) + String(4)", "34"],
  "primitive toString": ['(12).toString() + (255).toString(16) + true.toString() + "x".toString()', "12fftruex"],
  parseInt: ['parseInt("42px") + parseInt("ff", 16)', "297"],
  "parseInt of junk": ['parseInt("x") ?? "none"', "none"],
  parseFloat: ['parseFloat("3.5 kg") * 2', "7"],
  "computed object key": ['["a", "b"].reduce((acc, k) => ({...acc, [k]: 1}), {}).b', "1"],
  "JSON.stringify": ["JSON.stringify(o)", '{"a":1,"b":2}'],
  "Date.now": ["Date.now() > 0", "true"],
  "Math and Object": ['Math.max(...[1, 5, 2]) + Object.keys(o).length', "7"],
  // syntax
  "optional chaining": ["xs[0]?.n", "a"],
  "optional method on null": ['o.z?.toUpperCase() ?? "none"', "none"],
  "optional index": ['o.z?.[0] ?? "none"', "none"],
  "list spread": ["[...xs, {n: 'c'}].length", "3"],
  "object spread": ["{...o, c: 3}.c + {...o, a: 9}.a", "12"],
  "argument spread": ["max(...xs.map(x => x.v))", "3"],
  "shorthand property": ['f = n => ({n})\nf("k").n', "k"],
  "block arrow": ['xs.map(x => { return x.n }).join("")', "ab"],
  "block arrow with const": ['xs.map(x => { const d = x.v * 2; return `${x.n}${d}` }).join(",")', "a6,b2"],
  "object destructuring": ['xs.map(({n}) => n).join("")', "ab"],
  "destructuring with rename and default": ['xs.map(({n: name, w = 0}) => name + w).join("")', "a0b0"],
  "array destructuring of entries": ['entries(o).map(([k, v]) => k + v).join(",")', "a1,b2"],
  "nested destructuring": ['[{p: {q: 1}}].map(({p: {q}}) => q).join("")', "1"],
  "destructuring in const": ['f = x => { const {n, v} = x; return n + v }\nf(xs[0])', "a3"],
  typeof: ['typeof 3 + typeof "x" + typeof null', "numberstringobject"],
  in: ['("a" in o) + "," + ("z" in o) + "," + (1 in xs)', "true,false,true"],
  // already supported; kept so they stay that way
  "named function in map": ['f = (x, i) => i\nxs.map(f).join("")', "01"],
  "strict equality": ["1 === 1 && 1 !== 2", "true"],
  "includes on a list": ['xs.map(x => x.n).includes("a")', "true"],
  "nested template": ['`${xs.length} items: ${xs.map(x => `${x.n}`).join()}`', "2 items: a,b"],
  nullish: ['o.z ?? "none"', "none"],
};

describe("JavaScript idioms in the UI language", () => {
  for (const [name, [source, expected]] of Object.entries(CASES)) {
    it(name, () => {
      const lines = source.split("\n");
      const body = lines.pop()!;
      const compiled = compile([PRELUDE, ...lines, `Text(${body})`].join("\n"));
      expect(compiled.diagnostics.filter((d) => d.severity !== "warning")).toEqual([]);
      const { roots, diagnostics } = evaluate(compiled.program!, initialState(compiled.program!));
      expect(diagnostics).toEqual([]);
      expect(roots[0].props.text).toBe(expected);
    });
  }

  it("explains what a block body cannot hold", () => {
    const { diagnostics } = compile("Text([1].map(x => { if (x) return 1 }).join())");
    expect(diagnostics[0].message).toContain("`{ }` function body holds `const name = ...` lines and one `return ...`");
  });

  it("rejects spreading into a component", () => {
    const { diagnostics } = compile('Row(...["a"])');
    expect(diagnostics[0].message).toContain("cannot spread into Row");
  });

  it("does not copy a loaded object's own __proto__ key when spreading it", () => {
    const compiled = compile('o = {...Load("d.json"), b: 2}\nKeyValue(o)');
    const loaded = JSON.parse('{"__proto__": {"polluted": "yes"}, "a": 1}');
    const data = new Map([[dataKey({ path: "d.json", raw: false }), { ok: true as const, value: loaded }]]);
    const { roots } = evaluate(compiled.program!, initialState(compiled.program!, data), data);
    const pairs = roots[0].props.pairs as object;
    expect(Object.keys(pairs)).toEqual(["a", "b"]);
    expect(Object.getPrototypeOf(pairs)).toBe(Object.prototype);
  });

  it("caps repeat and padStart at the text limit", () => {
    const compiled = compile('Text("ab".repeat(100000))\nText("".padStart(200000))');
    const { diagnostics } = evaluate(compiled.program!, initialState(compiled.program!));
    expect(diagnostics.map((d) => d.message)).toEqual([
      "text longer than 100000 characters",
      "text longer than 100000 characters",
    ]);
  });
});
