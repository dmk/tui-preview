import type {
  ResolvedTuiPreviewOptions,
  TuiArgv,
  TuiPreviewLegacyProps,
  TuiPreviewModernProps,
  TuiPreviewProps,
  TuiRenderMode,
  TuiRuntimeSize,
} from "../types.js";

const DEFAULT_SIZE: TuiRuntimeSize = { cols: 80, rows: 24 };
const EMPTY_ENV: Record<string, string> = {};
const EMPTY_ARGV: string[] = [];

function isModernProps(
  props: TuiPreviewProps
): props is TuiPreviewModernProps {
  return "wasm" in props;
}

function resolveArgvInput(argv: TuiArgv | undefined): (size: TuiRuntimeSize) => string[] {
  const value = argv ?? EMPTY_ARGV;
  if (typeof value === "function") {
    return value;
  }
  return () => value;
}

function resolveLegacySize(props: TuiPreviewLegacyProps): {
  fit: ResolvedTuiPreviewOptions["fit"];
  size: TuiRuntimeSize;
} {
  const hasExplicitSize = props.cols !== undefined || props.rows !== undefined;
  if (!hasExplicitSize) {
    return { fit: "container", size: DEFAULT_SIZE };
  }
  return {
    fit: "none",
    size: {
      cols: Math.max(1, props.cols ?? DEFAULT_SIZE.cols),
      rows: Math.max(1, props.rows ?? DEFAULT_SIZE.rows),
    },
  };
}

let warnedLegacyProps = false;

export function warnLegacyPropsOnce(usedLegacyProps: boolean) {
  if (!usedLegacyProps || warnedLegacyProps) return;
  warnedLegacyProps = true;
  console.warn(
    "[tui-preview] Legacy props (`app`, `args`, `cols`, `rows`, `fontSize`, `fontFamily`, `theme`) are deprecated. " +
      "Use `wasm`, `argv`, `fit`, `size`, and `terminal`."
  );
}

export function resolveTuiPreviewProps(
  props: TuiPreviewProps
): ResolvedTuiPreviewOptions {
  if (isModernProps(props)) {
    const fit = props.fit ?? (props.size ? "none" : "container");
    const size = fit === "none"
      ? {
          cols: Math.max(1, props.size?.cols ?? DEFAULT_SIZE.cols),
          rows: Math.max(1, props.size?.rows ?? DEFAULT_SIZE.rows),
        }
      : {
          cols: Math.max(1, props.size?.cols ?? DEFAULT_SIZE.cols),
          rows: Math.max(1, props.size?.rows ?? DEFAULT_SIZE.rows),
        };

    const mode = (props.mode ?? "terminal") as TuiRenderMode;
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
        cursorBlink: props.terminal?.cursorBlink ?? true,
        convertEol: props.terminal?.convertEol ?? true,
        theme: props.terminal?.theme,
      },
      resolveArgv: resolveArgvInput(props.argv),
      onExit: props.onExit,
      onError: props.onError,
      onStatusChange: props.onStatusChange,
      usedLegacyProps: false,
    };
  }

  const { fit, size } = resolveLegacySize(props);
  return {
    wasm: props.app,
    env: props.env ?? EMPTY_ENV,
    interactive: props.interactive ?? true,
    mode: "terminal" as TuiRenderMode,
    fit,
    size,
    terminal: {
      fontSize: props.fontSize ?? 14,
      fontFamily: props.fontFamily ?? "monospace",
      cursorBlink: true,
      convertEol: true,
      theme: props.theme,
    },
    resolveArgv: resolveArgvInput(props.args),
    onExit: props.onExit,
    onError: props.onError,
    onStatusChange: props.onStatusChange,
    usedLegacyProps: true,
  };
}
