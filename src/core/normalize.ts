import type {
  ResolvedTuiPreviewOptions,
  TuiArgv,
  TuiPreviewProps,
  TuiRenderMode,
  TuiRuntimeSize,
} from "../types.js";

const DEFAULT_SIZE: TuiRuntimeSize = { cols: 80, rows: 24 };
const EMPTY_ENV: Record<string, string> = {};
const EMPTY_ARGV: string[] = [];

function normalizeMode(mode: TuiRenderMode | undefined): ResolvedTuiPreviewOptions["mode"] {
  if (mode === "static") {
    return "static";
  }
  return "interactive";
}

function resolveArgvInput(argv: TuiArgv | undefined): (size: TuiRuntimeSize) => string[] {
  const value = argv ?? EMPTY_ARGV;
  if (typeof value === "function") {
    return value;
  }
  return () => value;
}

export function resolveTuiPreviewProps(
  props: TuiPreviewProps
): ResolvedTuiPreviewOptions {
  const fit = props.fit ?? (props.size ? "none" : "container");
  const size = {
    cols: Math.max(1, props.size?.cols ?? DEFAULT_SIZE.cols),
    rows: Math.max(1, props.size?.rows ?? DEFAULT_SIZE.rows),
  };
  const mode = normalizeMode(props.mode);

  return {
    wasm: props.wasm,
    env: props.env ?? EMPTY_ENV,
    interactive: mode === "static" ? false : (props.interactive ?? true),
    mode,
    fit,
    size,
    terminal: {
      fontSize: props.terminal?.fontSize ?? 14,
      fontFamily: props.terminal?.fontFamily ?? "monospace",
      wasmUrl: props.terminal?.wasmUrl,
      convertEol: props.terminal?.convertEol ?? true,
      theme: props.terminal?.theme,
    },
    resolveArgv: resolveArgvInput(props.argv),
    onExit: props.onExit,
    onError: props.onError,
    onStatusChange: props.onStatusChange,
  };
}
