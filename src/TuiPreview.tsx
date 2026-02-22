import { useEffect, useMemo, useRef, useState } from "react";
import { createMiniTerminalSurface, measureCellSize } from "./core/libghostty.js";
import { resolveTuiPreviewProps } from "./core/normalize.js";
import { WasiBridge, instantiateApp } from "./core/wasi.js";
import type { TuiPreviewProps, TuiPreviewStatus, TuiRuntimeSize } from "./types.js";

export function TuiPreview(props: TuiPreviewProps) {
  const resolved = useMemo(() => resolveTuiPreviewProps(props), [props]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TuiPreviewStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const cellSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [termSize, setTermSize] = useState<TuiRuntimeSize | null>(
    resolved.fit === "container" ? null : resolved.size
  );

  useEffect(() => {
    setTermSize(resolved.fit === "container" ? null : resolved.size);
  }, [resolved.fit, resolved.size.cols, resolved.size.rows]);

  useEffect(() => {
    if (resolved.fit !== "container") return;
    if (!wrapperRef.current) return;
    const wrapper = wrapperRef.current;
    const estimatedCell = measureCellSize(resolved.terminal.fontSize, resolved.terminal.fontFamily);

    const updateFromPixels = (width: number, height: number) => {
      const cellW = cellSizeRef.current?.w ?? estimatedCell.w;
      const cellH = cellSizeRef.current?.h ?? estimatedCell.h;
      const newCols = Math.max(1, Math.floor(width / cellW));
      const newRows = Math.max(1, Math.floor(height / cellH));
      setTermSize((prev) => {
        if (prev && prev.cols === newCols && prev.rows === newRows) return prev;
        return { cols: newCols, rows: newRows };
      });
    };

    const rect = wrapper.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      updateFromPixels(rect.width, rect.height);
    }

    // Current fit strategy recalculates cols/rows from measured cell size and
    // recreates the surface on size changes. This is acceptable for now, but
    // an in-place resize path would be smoother for frequent container resizes.
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        updateFromPixels(width, height);
      }
    });

    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [resolved.fit, resolved.terminal.fontSize, resolved.terminal.fontFamily]);

  useEffect(() => {
    if (!termSize || !containerRef.current) return;

    let cancelled = false;
    let disposeRenderSurface: (() => void) | null = null;
    const container = containerRef.current;
    const activeSize = termSize;
    const setStatusAndNotify = (next: TuiPreviewStatus) => {
      setStatus(next);
      resolved.onStatusChange?.(next);
    };

    const setError = (err: unknown) => {
      setStatusAndNotify("error");
      setErrorMsg(err instanceof Error ? err.message : String(err));
      resolved.onError?.(err);
    };

    setStatusAndNotify("loading");
    setErrorMsg("");

    async function setup() {
      try {
        let appCols = activeSize.cols;
        let appRows = activeSize.rows;
        let bridge: WasiBridge | null = null;

        const surface = await createMiniTerminalSurface({
          container,
          cols: activeSize.cols,
          rows: activeSize.rows,
          fontSize: resolved.terminal.fontSize,
          fontFamily: resolved.terminal.fontFamily,
          theme: resolved.terminal.theme,
          convertEol: resolved.terminal.convertEol,
          interactive: resolved.mode !== "static" && resolved.interactive,
          showCursor: resolved.mode !== "static",
          wasmUrl: resolved.terminal.wasmUrl,
          onInput: (data) => bridge?.pushInput(data),
        });
        if (cancelled) {
          surface.dispose();
          return;
        }

        disposeRenderSurface = () => surface.dispose();
        appCols = surface.cols;
        appRows = surface.rows;
        cellSizeRef.current = surface.cellSize;

        const resolvedArgs = resolved.resolveArgv({ cols: appCols, rows: appRows });
        const stdoutDecoder = new TextDecoder();
        const stderrDecoder = new TextDecoder();
        const flushSurfaceOutput = (data: Uint8Array, decoder: TextDecoder) => {
          const decoded = decoder.decode(data, { stream: true });
          if (decoded) {
            surface.write(decoded);
          }
          for (const response of surface.drainResponses()) {
            bridge?.pushInput(response);
          }
        };

        bridge = new WasiBridge({
          args: [resolved.wasm.toString(), ...resolvedArgs],
          env: resolved.env,
          stdout: (data) => flushSurfaceOutput(data, stdoutDecoder),
          stderr: (data) => flushSurfaceOutput(data, stderrDecoder),
          onExit: (code) => {
            if (!cancelled) {
              setStatusAndNotify("exited");
              resolved.onExit?.(code);
            }
          },
        });

        const wasmApp = await instantiateApp(resolved.wasm, bridge);
        if (cancelled) return;

        setStatusAndNotify("running");

        queueMicrotask(() => {
          if (cancelled) return;
          void wasmApp.run().catch((runError) => {
            if (!cancelled) {
              setError(runError);
            }
          });
        });
      } catch (e) {
        if (!cancelled) {
          setError(e);
        }
      }
    }

    setup();

    return () => {
      cancelled = true;
      disposeRenderSurface?.();
      disposeRenderSurface = null;
    };
  }, [
    resolved.mode,
    termSize,
    resolved.wasm,
    resolved.resolveArgv,
    resolved.env,
    resolved.fit,
    resolved.interactive,
    resolved.onExit,
    resolved.onError,
    resolved.onStatusChange,
    resolved.terminal.fontSize,
    resolved.terminal.fontFamily,
    resolved.terminal.theme,
    resolved.terminal.wasmUrl,
    resolved.terminal.convertEol,
  ]);

  return (
    <div
      ref={wrapperRef}
      className={props.className}
      style={{
        position: "relative",
        display: resolved.fit === "container" ? "block" : "inline-block",
        background: resolved.terminal.theme?.background ?? "#1a1b26",
        borderRadius: 6,
        overflow: "hidden",
        ...props.style,
      }}
    >
      <div ref={containerRef} style={{ display: status === "error" ? "none" : undefined }} />
      {status === "loading" && (
        <div style={overlayStyle}>Loading…</div>
      )}
      {status === "error" && (
        <div style={{ ...overlayStyle, color: "#f7768e" }}>
          Error: {errorMsg}
        </div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  padding: "1rem",
  fontFamily: "monospace",
  fontSize: 14,
  color: "#a9b1d6",
};
