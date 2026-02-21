let ghosttyReady: Promise<typeof import("ghostty-web")> | null = null;

/** Load ghostty-web lazily to avoid SSR issues in host apps. */
export function loadGhostty() {
  if (!ghosttyReady) {
    ghosttyReady = import("ghostty-web").then(async (mod) => {
      await mod.init();
      return mod;
    });
  }
  return ghosttyReady;
}
