import { useEffect, useMemo, useRef, useState } from "react";
import { loadGhostty } from "./core/ghostty.js";
import { resolveTuiPreviewProps, warnLegacyPropsOnce } from "./core/normalize.js";
import { WasiBridge, instantiateApp } from "./core/wasi.js";
import type { TuiPreviewProps, TuiPreviewStatus, TuiRuntimeSize } from "./types.js";

export function TuiPreview(props: TuiPreviewProps) {
  const resolved = useMemo(() => resolveTuiPreviewProps(props), [props]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("ghostty-web").Terminal | null>(null);
  const [status, setStatus] = useState<TuiPreviewStatus>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const cellSizeRef = useRef<{ w: number; h: number } | null>(null);

  const [termSize, setTermSize] = useState<TuiRuntimeSize | null>(resolved.size);

  useEffect(() => {
    warnLegacyPropsOnce(resolved.usedLegacyProps);
  }, [resolved.usedLegacyProps]);

  useEffect(() => {
    setTermSize(resolved.size);
  }, [resolved.fit, resolved.size.cols, resolved.size.rows]);

  useEffect(() => {
    if (resolved.fit !== "container") return;
    if (!wrapperRef.current) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        const cellW = cellSizeRef.current?.w ?? resolved.terminal.fontSize * 0.6;
        const cellH = cellSizeRef.current?.h ?? resolved.terminal.fontSize * 1.2;
        setTermSize({
          cols: Math.max(1, Math.floor(width / cellW)),
          rows: Math.max(1, Math.floor(height / cellH)),
        });
      }
    });

    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [resolved.fit, resolved.terminal.fontSize]);

  useEffect(() => {
    if (!termSize || !containerRef.current) return;

    let cancelled = false;
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
        const ghostty = await loadGhostty();
        if (cancelled) return;

        container.innerHTML = "";
        const term = new ghostty.Terminal({
          cols: activeSize.cols,
          rows: activeSize.rows,
          fontSize: resolved.terminal.fontSize,
          fontFamily: resolved.terminal.fontFamily,
          theme: resolved.terminal.theme,
          disableStdin: !resolved.interactive,
          cursorBlink: resolved.terminal.cursorBlink,
          convertEol: resolved.terminal.convertEol,
        });

        termRef.current = term;
        term.open(container);

        let appCols = term.cols;
        let appRows = term.rows;

        if (resolved.fit === "container") {
          const fitAddon = new ghostty.FitAddon();
          term.loadAddon(fitAddon);
          fitAddon.fit();

          appCols = term.cols;
          appRows = term.rows;

          if (wrapperRef.current && appCols > 0 && appRows > 0) {
            cellSizeRef.current = {
              w: wrapperRef.current.clientWidth / appCols,
              h: wrapperRef.current.clientHeight / appRows,
            };
          }
        }

        const resolvedArgs = resolved.resolveArgv({ cols: appCols, rows: appRows });

        const decoder = new TextDecoder();

        const bridge = new WasiBridge({
          args: [resolved.wasm.toString(), ...resolvedArgs],
          env: resolved.env,
          stdout: (data) => term.write(decoder.decode(data)),
          stderr: (data) => term.write(decoder.decode(data)),
          onExit: (code) => {
            if (!cancelled) {
              setStatusAndNotify("exited");
              resolved.onExit?.(code);
            }
          },
        });

        if (resolved.interactive) {
          term.onData((data: string) => bridge.pushInput(data));
        }

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
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [
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
    resolved.terminal.cursorBlink,
    resolved.terminal.convertEol,
  ]);

  return (
    <div
      ref={wrapperRef}
      className={props.className}
      style={{
        position: "relative",
        display: "inline-block",
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
