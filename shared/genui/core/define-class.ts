/**
 * Builds a constructor from a function and a prototype of methods, without `class` syntax.
 *
 * Plugin client bundles run in Hermes on mobile, which has no `class` syntax
 * (`class X {}` is a syntax error there, and a lazily compiled one evaluates to
 * `undefined`, so `new X()` fails with "Cannot read property 'prototype' of
 * undefined"). Paseo compiles plugin bundles for es2020, so they keep `class`.
 * Everything under shared/ and client/ that is `new`ed goes through this.
 *
 * `init` assigns the instance fields. `methods` become non-enumerable prototype
 * members, as class methods are. `parent` links the prototype chain.
 */
export function defineClass<Args extends unknown[], Instance extends object, Methods extends object = {}>(
  init: (this: Instance, ...args: Args) => void,
  methods?: Methods & ThisType<Instance & Methods>,
  parent?: abstract new (...args: never[]) => object,
): new (...args: Args) => Instance & Methods {
  function Constructor(this: Instance, ...args: Args): void {
    init.apply(this, args);
  }
  const prototype = Object.create(
    parent === undefined ? Object.prototype : (parent as unknown as { readonly prototype: object }).prototype,
  ) as object;
  Object.defineProperty(prototype, "constructor", { value: Constructor, writable: true, configurable: true });
  if (methods !== undefined) {
    for (const name of Object.keys(methods)) {
      Object.defineProperty(prototype, name, {
        value: (methods as Record<string, unknown>)[name],
        writable: true,
        configurable: true,
      });
    }
  }
  Constructor.prototype = prototype;
  return Constructor as unknown as new (...args: Args) => Instance & Methods;
}
