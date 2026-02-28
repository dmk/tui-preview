/** JSPI (JavaScript Promise Integration) type extensions for WebAssembly. */

declare namespace WebAssembly {
  /**
   * Wraps an async JS function so it can be used as a suspending WASM import.
   * When the WASM module calls this import and the function awaits, the
   * entire WASM stack is suspended until the promise resolves.
   */
  class Suspending {
    constructor(fn: (...args: any[]) => Promise<any>);
  }

  /**
   * Wraps a WASM export so that calling it returns a Promise.
   * When the export suspends (due to a Suspending import), the returned
   * promise settles once execution completes.
   */
  function promising(fn: Function): (...args: any[]) => Promise<any>;
}
