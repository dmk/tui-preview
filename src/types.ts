export interface TuiRuntimeSize {
  cols: number;
  rows: number;
}

export type TuiArgv = string[] | ((size: TuiRuntimeSize) => string[]);
export type TuiFitMode = "container" | "none";
export type TuiPreviewStatus = "loading" | "running" | "exited" | "error";

export interface TuiTerminalOptions {
  /** Font size in pixels. Default: 14 */
  fontSize?: number;
  /** CSS font family. Default: monospace */
  fontFamily?: string;
  /** ghostty-web theme overrides */
  theme?: Partial<GhosttyTheme>;
  /** Cursor blinking. Default: true */
  cursorBlink?: boolean;
  /** Convert LF to CRLF. Default: true */
  convertEol?: boolean;
}

export interface TuiPreviewCommonProps {
  /** Environment variables (TERM, COLORTERM are set automatically) */
  env?: Record<string, string>;
  /** Whether the user can type into the terminal. Default: true */
  interactive?: boolean;
  /** Called when the app exits */
  onExit?: (code: number) => void;
  /** Called on runtime errors */
  onError?: (error: unknown) => void;
  /** Called whenever status changes */
  onStatusChange?: (status: TuiPreviewStatus) => void;
  className?: string;
  style?: React.CSSProperties;
}

export interface TuiPreviewModernProps extends TuiPreviewCommonProps {
  /** URL or path to a wasm32-wasi binary */
  wasm: string | URL;
  /** CLI argv (without argv[0]), static or size-aware */
  argv?: TuiArgv;
  /** "container" auto-fit or "none" fixed size. Default: "container" */
  fit?: TuiFitMode;
  /** Fixed size (fit="none") or initial fallback (fit="container") */
  size?: TuiRuntimeSize;
  /** Terminal renderer options */
  terminal?: TuiTerminalOptions;
}

/**
 * Legacy API retained for backwards compatibility.
 * Prefer `TuiPreviewModernProps`.
 */
export interface TuiPreviewLegacyProps extends TuiPreviewCommonProps {
  app: string | URL;
  args?: TuiArgv;
  cols?: number;
  rows?: number;
  fontSize?: number;
  fontFamily?: string;
  theme?: Partial<GhosttyTheme>;
}

export type TuiPreviewProps = TuiPreviewModernProps | TuiPreviewLegacyProps;

export interface GhosttyTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  selectionForeground: string;
  // ANSI 16 colors
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface WasiOptions {
  args: string[];
  env: Record<string, string>;
  stdout: (data: Uint8Array) => void;
  stderr: (data: Uint8Array) => void;
  onExit: (code: number) => void;
}

export interface ResolvedTuiPreviewOptions {
  wasm: string | URL;
  env: Record<string, string>;
  interactive: boolean;
  fit: TuiFitMode;
  size: TuiRuntimeSize;
  terminal: Required<Omit<TuiTerminalOptions, "theme">> & {
    theme?: Partial<GhosttyTheme>;
  };
  resolveArgv: (size: TuiRuntimeSize) => string[];
  onExit?: (code: number) => void;
  onError?: (error: unknown) => void;
  onStatusChange?: (status: TuiPreviewStatus) => void;
  usedLegacyProps: boolean;
}
