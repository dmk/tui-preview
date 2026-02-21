/**
 * WASI bridge — connects a wasm32-wasi TUI app to a ghostty-web terminal.
 *
 * Implements a minimal WASI preview1 surface sufficient for interactive TUI apps:
 *   - fd_write (stdout/stderr → terminal)
 *   - fd_read (stdin ← keyboard input queue)
 *   - poll_oneoff (non-blocking stdin check, needed by crossterm/ratatui)
 *   - proc_exit
 *   - environ_get / environ_sizes_get
 *   - args_get / args_sizes_get
 */

import type { WasiOptions } from "../types.js";

const WASI_ESUCCESS = 0;
const WASI_EAGAIN = 6;
const WASI_BADF = 8;

const STDIN_FD = 0;
const STDOUT_FD = 1;
const STDERR_FD = 2;

export class WasiBridge {
  private inputQueue: Uint8Array[] = [];
  private memory!: WebAssembly.Memory;

  constructor(private opts: WasiOptions) {}

  /** Push keyboard data from the terminal into the app's stdin */
  pushInput(data: string | Uint8Array) {
    const chunk = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.inputQueue.push(chunk);
  }

  /** Attach the WASM instance's memory after instantiation */
  attachMemory(memory: WebAssembly.Memory) {
    this.memory = memory;
  }

  private view() {
    return new DataView(this.memory.buffer);
  }

  private u8() {
    return new Uint8Array(this.memory.buffer);
  }

  // ── WASI imports object ────────────────────────────────────────────────

  get imports(): WebAssembly.ModuleImports {
    return {
      args_sizes_get: (argcPtr: number, argvBufSizePtr: number) => {
        const { args } = this.opts;
        const enc = new TextEncoder();
        const total = args.reduce((sum, arg) => sum + enc.encode(arg).length + 1, 0);
        this.view().setUint32(argcPtr, args.length, true);
        this.view().setUint32(argvBufSizePtr, total, true);
        return WASI_ESUCCESS;
      },

      args_get: (argvPtr: number, argvBufPtr: number) => {
        const enc = new TextEncoder();
        const u8 = this.u8();
        const view = this.view();
        let bufOffset = argvBufPtr;
        this.opts.args.forEach((arg, i) => {
          const bytes = enc.encode(arg);
          u8.set(bytes, bufOffset);
          u8[bufOffset + bytes.length] = 0;
          view.setUint32(argvPtr + i * 4, bufOffset, true);
          bufOffset += bytes.length + 1;
        });
        return WASI_ESUCCESS;
      },

      environ_sizes_get: (countPtr: number, bufSizePtr: number) => {
        const entries = this.envEntries();
        const enc = new TextEncoder();
        const total = entries.reduce((sum, entry) => sum + enc.encode(entry).length + 1, 0);
        this.view().setUint32(countPtr, entries.length, true);
        this.view().setUint32(bufSizePtr, total, true);
        return WASI_ESUCCESS;
      },

      environ_get: (environPtr: number, environBufPtr: number) => {
        const enc = new TextEncoder();
        const u8 = this.u8();
        const view = this.view();
        let bufOffset = environBufPtr;
        this.envEntries().forEach((entry, i) => {
          const bytes = enc.encode(entry);
          u8.set(bytes, bufOffset);
          u8[bufOffset + bytes.length] = 0;
          view.setUint32(environPtr + i * 4, bufOffset, true);
          bufOffset += bytes.length + 1;
        });
        return WASI_ESUCCESS;
      },

      fd_write: (fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number) => {
        if (fd !== STDOUT_FD && fd !== STDERR_FD) return WASI_BADF;
        const view = this.view();
        const u8 = this.u8();
        let nwritten = 0;
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovsPtr + i * 8, true);
          const len = view.getUint32(iovsPtr + i * 8 + 4, true);
          chunks.push(u8.slice(ptr, ptr + len));
          nwritten += len;
        }
        const merged = new Uint8Array(nwritten);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        if (fd === STDOUT_FD) {
          this.opts.stdout(merged);
        } else {
          this.opts.stderr(merged);
        }
        view.setUint32(nwrittenPtr, nwritten, true);
        return WASI_ESUCCESS;
      },

      fd_read: (fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number) => {
        if (fd !== STDIN_FD) return WASI_BADF;
        const chunk = this.inputQueue.shift();
        if (!chunk) return WASI_EAGAIN;
        const view = this.view();
        const u8 = this.u8();
        let nread = 0;
        for (let i = 0; i < iovsLen && nread < chunk.length; i++) {
          const ptr = view.getUint32(iovsPtr + i * 8, true);
          const len = view.getUint32(iovsPtr + i * 8 + 4, true);
          const toCopy = Math.min(len, chunk.length - nread);
          u8.set(chunk.subarray(nread, nread + toCopy), ptr);
          nread += toCopy;
        }
        view.setUint32(nreadPtr, nread, true);
        return WASI_ESUCCESS;
      },

      poll_oneoff: (inPtr: number, outPtr: number, nsubscriptions: number, neventsPtr: number) => {
        const view = this.view();
        let nevents = 0;
        for (let i = 0; i < nsubscriptions; i++) {
          const subPtr = inPtr + i * 48;
          const type = view.getUint8(subPtr + 8);
          if (type === 0 && this.inputQueue.length > 0) {
            const evPtr = outPtr + nevents * 32;
            view.setBigUint64(evPtr, view.getBigUint64(subPtr, true), true);
            view.setUint16(evPtr + 8, 0, true);
            view.setUint8(evPtr + 10, type);
            nevents++;
          }
        }
        view.setUint32(neventsPtr, nevents, true);
        return WASI_ESUCCESS;
      },

      proc_exit: (code: number) => {
        this.opts.onExit(code);
        throw new WasiExitError(code);
      },

      random_get: (bufPtr: number, bufLen: number) => {
        crypto.getRandomValues(new Uint8Array(this.memory.buffer, bufPtr, bufLen));
        return WASI_ESUCCESS;
      },

      // Stubs for calls TUI apps may make but we don't need to implement.
      fd_close: () => WASI_ESUCCESS,
      fd_seek: () => WASI_ESUCCESS,
      fd_fdstat_get: (fd: number, ptr: number) => {
        const view = this.view();
        view.setUint8(ptr, fd <= 2 ? 2 : 0); // 2=char_device
        return WASI_ESUCCESS;
      },
      fd_prestat_get: () => WASI_BADF,
      fd_prestat_dir_name: () => WASI_BADF,
      path_open: () => WASI_BADF,
      sched_yield: () => WASI_ESUCCESS,
      clock_time_get: (_id: number, _precision: bigint, timePtr: number) => {
        const ns = BigInt(Date.now()) * 1_000_000n;
        this.view().setBigUint64(timePtr, ns, true);
        return WASI_ESUCCESS;
      },
    };
  }

  private envEntries(): string[] {
    const base: Record<string, string> = {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ...this.opts.env,
    };
    return Object.entries(base).map(([k, v]) => `${k}=${v}`);
  }
}

export class WasiExitError extends Error {
  constructor(public readonly code: number) {
    super(`WASI exit: ${code}`);
  }
}

/** Compiled module cache — keyed by URL string, persists for the page lifetime. */
const moduleCache = new Map<string, WebAssembly.Module>();

/** Load and instantiate a WASM TUI app with a WasiBridge */
export async function instantiateApp(
  source: string | URL,
  bridge: WasiBridge
): Promise<{ run: () => Promise<void> }> {
  const key = source.toString();
  let module = moduleCache.get(key);
  if (!module) {
    const response = await fetch(source);
    const bytes = await response.arrayBuffer();
    module = await WebAssembly.compile(bytes);
    moduleCache.set(key, module);
  }

  const importObject: WebAssembly.Imports = {
    wasi_snapshot_preview1: bridge.imports,
  };

  const instance = await WebAssembly.instantiate(module, importObject);
  bridge.attachMemory(instance.exports.memory as WebAssembly.Memory);

  const _start = instance.exports._start as (() => void) | undefined;
  if (!_start) throw new Error("WASM module has no _start export");

  return {
    run: async () => {
      try {
        _start();
      } catch (e) {
        if (!(e instanceof WasiExitError)) throw e;
      }
    },
  };
}
