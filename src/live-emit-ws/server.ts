import { startLiveEmitWsRuntime } from "./runtime";

async function main() {
  const runtime = await startLiveEmitWsRuntime();
  const wsBase = process.env.LIVE_EMIT_WS_PUBLIC_BASE || `ws://127.0.0.1:${runtime.port}`;
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      severity: "INFO",
      service: "live-emit-ws",
      event: "server_listening",
      ws_url: `${wsBase}${runtime.path}`,
      version: runtime.version,
      deployed_at: runtime.deployedAt,
      timestamp: new Date().toISOString(),
    }),
  );

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        severity: "INFO",
        service: "live-emit-ws",
        event: "server_shutdown_requested",
        signal,
        version: runtime.version,
        timestamp: new Date().toISOString(),
      }),
    );
    await runtime.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      severity: "ERROR",
      service: "live-emit-ws",
      event: "server_startup_failed",
      message: error instanceof Error ? error.message : "unknown",
      timestamp: new Date().toISOString(),
    }),
  );
  process.exit(1);
});
