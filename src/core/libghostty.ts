import type { GhosttyTheme } from "../types.js";

const EXPECTED_CELL_SIZE = 16;
const EXPECTED_TERMINAL_CONFIG_SIZE = 80;
const DEFAULT_WASM_URL = new URL("./ghostty-vt.wasm", import.meta.url).href;

const FLAG_BOLD = 1 << 0;
const FLAG_ITALIC = 1 << 1;
const FLAG_UNDERLINE = 1 << 2;
const FLAG_FG_EXPLICIT = 1 << 3;
const FLAG_INVERSE = 1 << 4;
const FLAG_INVISIBLE = 1 << 5;
const FLAG_BG_EXPLICIT = 1 << 6;
const FLAG_FAINT = 1 << 7;

const ANSI_THEME_KEYS: (keyof GhosttyTheme)[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

const DEFAULT_THEME: GhosttyTheme = {
  background: "#1a1b26",
  foreground: "#a9b1d6",
  cursor: "#c0caf5",
  selectionBackground: "#33467c",
  selectionForeground: "#c0caf5",
  black: "#15161e",
  red: "#f7768e",
  green: "#9ece6a",
  yellow: "#e0af68",
  blue: "#7aa2f7",
  magenta: "#bb9af7",
  cyan: "#7dcfff",
  white: "#a9b1d6",
  brightBlack: "#414868",
  brightRed: "#f7768e",
  brightGreen: "#9ece6a",
  brightYellow: "#e0af68",
  brightBlue: "#7aa2f7",
  brightMagenta: "#bb9af7",
  brightCyan: "#7dcfff",
  brightWhite: "#c0caf5",
};

interface LibGhosttyExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  ghostty_wasm_alloc_u8_array(len: number): number;
  ghostty_wasm_free_u8_array(ptr: number, len: number): void;
  ghostty_terminal_new(cols: number, rows: number): number;
  ghostty_terminal_new_with_config(cols: number, rows: number, configPtr: number): number;
  ghostty_terminal_free(handle: number): void;
  ghostty_terminal_resize(handle: number, cols: number, rows: number): void;
  ghostty_terminal_write(handle: number, dataPtr: number, dataLen: number): void;
  ghostty_render_state_update(handle: number): number;
  ghostty_render_state_get_cols(handle: number): number;
  ghostty_render_state_get_rows(handle: number): number;
  ghostty_render_state_is_row_dirty(handle: number, row: number): boolean;
  ghostty_render_state_mark_clean(handle: number): void;
  ghostty_render_state_get_viewport(handle: number, bufPtr: number, bufLen: number): number;
  ghostty_terminal_has_response(handle: number): boolean;
  ghostty_terminal_read_response(handle: number, bufPtr: number, bufLen: number): number;
}

interface GhosttyTerminalConfig {
  fgColor: number;
  bgColor: number;
  cursorColor: number;
  palette: number[];
}

interface FontMetrics {
  width: number;
  height: number;
  baseline: number;
}

export interface MiniTerminalSurfaceOptions {
  container: HTMLElement;
  /** Explicit cell dimensions — used directly when provided. */
  cols?: number;
  rows?: number;
  /** Pixel dimensions — if provided, cols/rows are computed from font metrics. */
  widthPx?: number;
  heightPx?: number;
  fontSize: number;
  fontFamily: string;
  theme?: Partial<GhosttyTheme>;
  convertEol: boolean;
  interactive: boolean;
  showCursor: boolean;
  onInput?: (data: string) => void;
  wasmUrl?: string | URL;
}

export interface MiniTerminalSurface {
  cols: number;
  rows: number;
  cellSize: { w: number; h: number };
  write(text: string): void;
  drainResponses(): string[];
  dispose(): void;
}

class LibGhosttyRuntime {
  constructor(
    private readonly wasm: LibGhosttyExports,
    private readonly abi: { cellSize: number; terminalConfigSize: number }
  ) {}

  createTerminal(cols: number, rows: number, theme: GhosttyTheme): LibGhosttyTerminal {
    const configPtr = this.wasm.ghostty_wasm_alloc_u8_array(this.abi.terminalConfigSize);
    if (!configPtr) {
      throw new Error("Failed to allocate terminal config.");
    }

    try {
      const view = new DataView(this.wasm.memory.buffer);
      let offset = configPtr;
      view.setUint32(offset, 10_000, true);
      offset += 4;
      view.setUint32(offset, parseColorToHex(theme.foreground), true);
      offset += 4;
      view.setUint32(offset, parseColorToHex(theme.background), true);
      offset += 4;
      view.setUint32(offset, parseColorToHex(theme.cursor), true);
      offset += 4;

      for (const key of ANSI_THEME_KEYS) {
        view.setUint32(offset, parseColorToHex(theme[key]), true);
        offset += 4;
      }

      const handle = this.wasm.ghostty_terminal_new_with_config(cols, rows, configPtr);
      if (!handle) {
        throw new Error("Failed to create libghostty terminal.");
      }
      return new LibGhosttyTerminal(this.wasm, handle, cols, rows, this.abi.cellSize);
    } finally {
      this.wasm.ghostty_wasm_free_u8_array(configPtr, this.abi.terminalConfigSize);
    }
  }
}

class LibGhosttyTerminal {
  private viewportPtr = 0;
  private viewportLen = 0;

  constructor(
    private readonly wasm: LibGhosttyExports,
    private readonly handle: number,
    public cols: number,
    public rows: number,
    private readonly cellSize: number
  ) {}

  write(textOrData: string | Uint8Array) {
    const data = typeof textOrData === "string" ? new TextEncoder().encode(textOrData) : textOrData;
    if (data.length === 0) return;
    const ptr = this.wasm.ghostty_wasm_alloc_u8_array(data.length);
    if (!ptr) {
      throw new Error("Failed to allocate libghostty write buffer.");
    }
    try {
      new Uint8Array(this.wasm.memory.buffer).set(data, ptr);
      this.wasm.ghostty_terminal_write(this.handle, ptr, data.length);
    } finally {
      this.wasm.ghostty_wasm_free_u8_array(ptr, data.length);
    }
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.wasm.ghostty_terminal_resize(this.handle, cols, rows);
    this.releaseViewport();
  }

  hasResponse() {
    return this.wasm.ghostty_terminal_has_response(this.handle);
  }

  isDirty() {
    return this.wasm.ghostty_render_state_update(this.handle) !== 0;
  }

  readResponse(maxBytes = 4096): string | null {
    const ptr = this.wasm.ghostty_wasm_alloc_u8_array(maxBytes);
    if (!ptr) {
      throw new Error("Failed to allocate libghostty response buffer.");
    }
    try {
      const written = this.wasm.ghostty_terminal_read_response(this.handle, ptr, maxBytes);
      if (written <= 0) return null;
      const bytes = new Uint8Array(this.wasm.memory.buffer, ptr, written);
      return new TextDecoder().decode(bytes);
    } finally {
      this.wasm.ghostty_wasm_free_u8_array(ptr, maxBytes);
    }
  }

  getViewportData(): {
    cols: number;
    rows: number;
    buffer: Uint8Array;
  } {
    const cols = this.wasm.ghostty_render_state_get_cols(this.handle);
    const rows = this.wasm.ghostty_render_state_get_rows(this.handle);
    this.cols = cols;
    this.rows = rows;
    const required = Math.max(1, cols * rows * this.cellSize);
    if (required > this.viewportLen || this.viewportPtr === 0) {
      this.releaseViewport();
      this.viewportPtr = this.wasm.ghostty_wasm_alloc_u8_array(required);
      this.viewportLen = required;
      if (!this.viewportPtr) {
        throw new Error("Failed to allocate libghostty viewport buffer.");
      }
    }
    const written = this.wasm.ghostty_render_state_get_viewport(this.handle, this.viewportPtr, this.viewportLen);
    const snapshot = new Uint8Array(written);
    if (written > 0) {
      const source = new Uint8Array(this.wasm.memory.buffer, this.viewportPtr, written);
      snapshot.set(source);
    }
    this.wasm.ghostty_render_state_mark_clean(this.handle);
    return {
      cols,
      rows,
      buffer: snapshot,
    };
  }

  dispose() {
    this.releaseViewport();
    this.wasm.ghostty_terminal_free(this.handle);
  }

  private releaseViewport() {
    if (this.viewportPtr === 0) return;
    this.wasm.ghostty_wasm_free_u8_array(this.viewportPtr, this.viewportLen);
    this.viewportPtr = 0;
    this.viewportLen = 0;
  }
}

class MiniRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dpr: number;
  private metrics: FontMetrics;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private cols: number,
    private rows: number,
    private readonly fontSize: number,
    private readonly fontFamily: string,
    private readonly theme: GhosttyTheme
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to create 2D canvas context.");
    }
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
    this.metrics = this.measureFont();
    this.resizeCanvas(cols, rows);
  }

  get cellSize() {
    return { w: this.metrics.width, h: this.metrics.height };
  }

  render(viewport: { cols: number; rows: number; buffer: Uint8Array }) {
    if (viewport.cols !== this.cols || viewport.rows !== this.rows) {
      this.cols = viewport.cols;
      this.rows = viewport.rows;
      this.resizeCanvas(viewport.cols, viewport.rows);
    }

    const { cols, rows, buffer } = viewport;
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const ctx = this.ctx;
    const charW = this.metrics.width;
    const charH = this.metrics.height;

    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, cols * charW, rows * charH);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const base = (y * cols + x) * EXPECTED_CELL_SIZE;
        const width = view.getUint8(base + 11);
        if (width === 0) continue;
        const flags = view.getUint8(base + 10);
        const fg = readRgb(view, base + 4);
        const bg = readRgb(view, base + 7);
        const inverse = hasFlag(flags, FLAG_INVERSE);
        const fgColor = hasFlag(flags, FLAG_FG_EXPLICIT) ? rgbToCss(fg) : this.theme.foreground;
        const bgColor = hasFlag(flags, FLAG_BG_EXPLICIT) ? rgbToCss(bg) : this.theme.background;
        if (inverse || hasFlag(flags, FLAG_BG_EXPLICIT)) {
          ctx.fillStyle = inverse ? fgColor : bgColor;
          ctx.fillRect(x * charW, y * charH, width * charW, charH);
        }
      }
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const base = (y * cols + x) * EXPECTED_CELL_SIZE;
        const width = view.getUint8(base + 11);
        if (width === 0) continue;
        const flags = view.getUint8(base + 10);
        if (hasFlag(flags, FLAG_INVISIBLE)) continue;

        const codepoint = view.getUint32(base, true);
        if (codepoint === 0) continue;

        const inverse = hasFlag(flags, FLAG_INVERSE);
        const fg = readRgb(view, base + 4);
        const bg = readRgb(view, base + 7);
        const fgColor = hasFlag(flags, FLAG_FG_EXPLICIT) ? rgbToCss(fg) : this.theme.foreground;
        const bgColor = hasFlag(flags, FLAG_BG_EXPLICIT) ? rgbToCss(bg) : this.theme.background;
        ctx.fillStyle = inverse ? bgColor : fgColor;

        let style = "";
        if (hasFlag(flags, FLAG_ITALIC)) style += "italic ";
        if (hasFlag(flags, FLAG_BOLD)) style += "bold ";
        ctx.font = `${style}${this.fontSize}px ${this.fontFamily}`;

        if (hasFlag(flags, FLAG_FAINT)) {
          ctx.globalAlpha = 0.5;
        }

        const text = safeCodepoint(codepoint);
        ctx.fillText(text, x * charW, y * charH + this.metrics.baseline);

        if (hasFlag(flags, FLAG_FAINT)) {
          ctx.globalAlpha = 1;
        }
        if (hasFlag(flags, FLAG_UNDERLINE)) {
          const underlineY = y * charH + this.metrics.baseline + 2;
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x * charW, underlineY);
          ctx.lineTo(x * charW + width * charW, underlineY);
          ctx.stroke();
        }
      }
    }
  }

  dispose() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private measureFont(): FontMetrics {
    this.ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    const metrics = this.ctx.measureText("M");
    const width = Math.ceil(metrics.width);
    const ascent = metrics.actualBoundingBoxAscent || this.fontSize * 0.8;
    const descent = metrics.actualBoundingBoxDescent || this.fontSize * 0.2;
    return {
      width,
      height: Math.ceil(ascent + descent) + 2,
      baseline: Math.ceil(ascent) + 1,
    };
  }

  private resizeCanvas(cols: number, rows: number) {
    const width = cols * this.metrics.width;
    const height = rows * this.metrics.height;
    this.canvas.width = Math.max(1, Math.floor(width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(height * this.dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.textBaseline = "alphabetic";
    this.ctx.textAlign = "left";
  }
}

/** Measure monospace cell size for a given font. Cheap and synchronous. */
export function measureCellSize(
  fontSize: number,
  fontFamily: string
): { w: number; h: number } {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      w: Math.ceil(fontSize * 0.6),
      h: Math.ceil(fontSize * 1.2),
    };
  }
  ctx.font = `${fontSize}px ${fontFamily}`;
  const m = ctx.measureText("M");
  const w = Math.ceil(m.width);
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.2;
  return { w, h: Math.ceil(ascent + descent) + 2 };
}

const runtimeCache = new Map<string, Promise<LibGhosttyRuntime>>();

export function loadLibGhostty(wasmUrl: string | URL = DEFAULT_WASM_URL): Promise<LibGhosttyRuntime> {
  const key = wasmUrl.toString();
  const cached = runtimeCache.get(key);
  if (cached) {
    return cached;
  }

  const runtimePromise = (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to load libghostty wasm: ${response.status} ${response.statusText}`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new Error("libghostty wasm is empty.");
    }
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {
      env: {
        log: () => {},
      },
    });
    const wasm = instance.exports as unknown as LibGhosttyExports;
    if (
      !wasm.memory ||
      !wasm.ghostty_terminal_new ||
      !wasm.ghostty_render_state_get_viewport
    ) {
      throw new Error("Invalid libghostty wasm exports.");
    }
    assertAbiCompatibility(wasm);
    return new LibGhosttyRuntime(wasm, {
      cellSize: EXPECTED_CELL_SIZE,
      terminalConfigSize: EXPECTED_TERMINAL_CONFIG_SIZE,
    });
  })();

  runtimeCache.set(key, runtimePromise);
  return runtimePromise;
}

export async function createMiniTerminalSurface(
  options: MiniTerminalSurfaceOptions
): Promise<MiniTerminalSurface> {
  const runtime = await loadLibGhostty(options.wasmUrl ?? DEFAULT_WASM_URL);
  const theme: GhosttyTheme = { ...DEFAULT_THEME, ...options.theme };

  let cols: number;
  let rows: number;
  const cell = measureCellSize(options.fontSize, options.fontFamily);
  if (options.widthPx != null && options.heightPx != null) {
    cols = Math.max(1, Math.floor(options.widthPx / cell.w));
    rows = Math.max(1, Math.floor(options.heightPx / cell.h));
  } else {
    cols = options.cols ?? 80;
    rows = options.rows ?? 24;
  }

  options.container.innerHTML = "";

  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.outline = "none";
  canvas.tabIndex = options.interactive ? 0 : -1;
  options.container.appendChild(canvas);

  const terminal = runtime.createTerminal(cols, rows, theme);
  const renderer = new MiniRenderer(
    canvas,
    cols,
    rows,
    options.fontSize,
    options.fontFamily,
    theme
  );

  if (!options.showCursor) {
    terminal.write("\x1b[?25l");
  }
  renderer.render(terminal.getViewportData());

  const requestFrame =
    window.requestAnimationFrame?.bind(window) ?? ((cb: FrameRequestCallback) => window.setTimeout(cb, 16));
  const cancelFrame = window.cancelAnimationFrame?.bind(window) ?? window.clearTimeout.bind(window);
  let frameId: number | null = null;
  let disposed = false;
  const renderFrame = () => {
    frameId = null;
    if (disposed || !terminal.isDirty()) return;
    renderer.render(terminal.getViewportData());
  };
  const scheduleRender = () => {
    if (frameId !== null || disposed) return;
    frameId = requestFrame(renderFrame) as number;
  };

  const detachInput = options.interactive
    ? attachBasicInput(canvas, (data) => options.onInput?.(data))
    : () => {};

  return {
    cols,
    rows,
    cellSize: renderer.cellSize,
    write(text: string) {
      if (disposed) return;
      const normalized = options.convertEol ? normalizeEol(text) : text;
      terminal.write(normalized);
      scheduleRender();
    },
    drainResponses() {
      if (disposed) return [];
      const responses: string[] = [];
      while (terminal.hasResponse()) {
        const response = terminal.readResponse();
        if (!response) break;
        responses.push(response);
      }
      return responses;
    },
    dispose() {
      disposed = true;
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      detachInput();
      renderer.dispose();
      terminal.dispose();
      if (canvas.parentElement === options.container) {
        options.container.removeChild(canvas);
      }
    },
  };
}

function assertAbiCompatibility(wasm: LibGhosttyExports): void {
  const configPtr = wasm.ghostty_wasm_alloc_u8_array(EXPECTED_TERMINAL_CONFIG_SIZE);
  if (!configPtr) {
    throw new Error("Failed to allocate ABI probe config buffer.");
  }

  let handle = 0;
  let writePtr = 0;
  let writeLen = 0;
  let viewportPtr = 0;

  const probeFg = 0x112233;
  const probeBg = 0x445566;
  const [probeFgR, probeFgG, probeFgB] = unpackHexColor(probeFg);
  const [probeBgR, probeBgG, probeBgB] = unpackHexColor(probeBg);

  try {
    new Uint8Array(wasm.memory.buffer, configPtr, EXPECTED_TERMINAL_CONFIG_SIZE).fill(0);
    const cfg = new DataView(wasm.memory.buffer, configPtr, EXPECTED_TERMINAL_CONFIG_SIZE);
    cfg.setUint32(0, 16, true);
    cfg.setUint32(4, probeFg, true);
    cfg.setUint32(8, probeBg, true);
    cfg.setUint32(12, 0x778899, true);

    handle = wasm.ghostty_terminal_new_with_config(2, 1, configPtr);
    if (!handle) {
      throw new Error("Failed to create ABI probe terminal.");
    }

    const probeWrite = new TextEncoder().encode("\x1b[7mX");
    writeLen = probeWrite.length;
    writePtr = wasm.ghostty_wasm_alloc_u8_array(writeLen);
    if (!writePtr) {
      throw new Error("Failed to allocate ABI probe write buffer.");
    }
    new Uint8Array(wasm.memory.buffer, writePtr, writeLen).set(probeWrite);
    wasm.ghostty_terminal_write(handle, writePtr, writeLen);

    viewportPtr = wasm.ghostty_wasm_alloc_u8_array(EXPECTED_CELL_SIZE);
    if (!viewportPtr) {
      throw new Error("Failed to allocate ABI probe viewport buffer.");
    }
    const written = wasm.ghostty_render_state_get_viewport(handle, viewportPtr, EXPECTED_CELL_SIZE);
    if (written !== EXPECTED_CELL_SIZE) {
      throw new Error(
        `Incompatible libghostty ABI: expected cell size ${EXPECTED_CELL_SIZE}, got ${written}.`
      );
    }

    const view = new DataView(wasm.memory.buffer, viewportPtr, EXPECTED_CELL_SIZE);
    const flags = view.getUint8(10);
    const hasFg = hasFlag(flags, FLAG_FG_EXPLICIT);
    const hasBg = hasFlag(flags, FLAG_BG_EXPLICIT);
    const fgMatches =
      view.getUint8(4) === probeFgR &&
      view.getUint8(5) === probeFgG &&
      view.getUint8(6) === probeFgB;
    const bgMatches =
      view.getUint8(7) === probeBgR &&
      view.getUint8(8) === probeBgG &&
      view.getUint8(9) === probeBgB;
    if (!hasFg || !hasBg || !fgMatches || !bgMatches) {
      throw new Error("Incompatible libghostty ABI: terminal config layout mismatch.");
    }
  } finally {
    if (viewportPtr) {
      wasm.ghostty_wasm_free_u8_array(viewportPtr, EXPECTED_CELL_SIZE);
    }
    if (writePtr && writeLen > 0) {
      wasm.ghostty_wasm_free_u8_array(writePtr, writeLen);
    }
    if (handle) {
      wasm.ghostty_terminal_free(handle);
    }
    wasm.ghostty_wasm_free_u8_array(configPtr, EXPECTED_TERMINAL_CONFIG_SIZE);
  }
}

function normalizeEol(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

function parseColorToHex(color: string): number {
  if (color.startsWith("#")) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    }
    const parsed = Number.parseInt(hex, 16);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!rgbMatch) return 0;
  const r = Number.parseInt(rgbMatch[1], 10);
  const g = Number.parseInt(rgbMatch[2], 10);
  const b = Number.parseInt(rgbMatch[3], 10);
  return (r << 16) | (g << 8) | b;
}

function unpackHexColor(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

function readRgb(view: DataView, offset: number): { r: number; g: number; b: number } {
  return {
    r: view.getUint8(offset),
    g: view.getUint8(offset + 1),
    b: view.getUint8(offset + 2),
  };
}

function hasFlag(flags: number, bit: number): boolean {
  return (flags & bit) !== 0;
}

function rgbToCss(rgb: { r: number; g: number; b: number }): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function safeCodepoint(codepoint: number): string {
  try {
    return String.fromCodePoint(codepoint);
  } catch {
    return " ";
  }
}

function attachBasicInput(target: HTMLElement, onInput: (data: string) => void) {
  const onMouseDown = () => target.focus();
  const onPaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData("text");
    if (!text) return;
    event.preventDefault();
    onInput(text);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const encoded = encodeKeyboardEvent(event);
    if (!encoded) return;
    event.preventDefault();
    onInput(encoded);
  };

  target.addEventListener("mousedown", onMouseDown);
  target.addEventListener("paste", onPaste);
  target.addEventListener("keydown", onKeyDown);

  return () => {
    target.removeEventListener("mousedown", onMouseDown);
    target.removeEventListener("paste", onPaste);
    target.removeEventListener("keydown", onKeyDown);
  };
}

function encodeKeyboardEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || event.metaKey) return null;

  let value: string | null = null;
  switch (event.key) {
    case "Enter":
      value = "\r";
      break;
    case "Backspace":
      value = "\x7f";
      break;
    case "Tab":
      value = event.shiftKey ? "\x1b[Z" : "\t";
      break;
    case "Escape":
      value = "\x1b";
      break;
    case "ArrowUp":
      value = "\x1b[A";
      break;
    case "ArrowDown":
      value = "\x1b[B";
      break;
    case "ArrowRight":
      value = "\x1b[C";
      break;
    case "ArrowLeft":
      value = "\x1b[D";
      break;
    case "Home":
      value = "\x1b[H";
      break;
    case "End":
      value = "\x1b[F";
      break;
    case "Delete":
      value = "\x1b[3~";
      break;
    case "PageUp":
      value = "\x1b[5~";
      break;
    case "PageDown":
      value = "\x1b[6~";
      break;
    default:
      break;
  }

  if (!value && event.ctrlKey) {
    value = encodeCtrlKey(event.key);
  }

  if (!value && event.key.length === 1 && !event.ctrlKey) {
    value = event.key;
  }

  if (!value) return null;
  if (event.altKey && !value.startsWith("\x1b")) {
    return `\x1b${value}`;
  }
  return value;
}

function encodeCtrlKey(key: string): string | null {
  if (key.length !== 1) return null;
  const upper = key.toUpperCase();
  if (upper >= "A" && upper <= "Z") {
    return String.fromCharCode(upper.charCodeAt(0) - 64);
  }
  switch (key) {
    case "@":
    case " ":
      return "\x00";
    case "[":
      return "\x1b";
    case "\\":
      return "\x1c";
    case "]":
      return "\x1d";
    case "^":
      return "\x1e";
    case "_":
      return "\x1f";
    default:
      return null;
  }
}
