import { execFileSync } from "node:child_process";
import { requireEnv } from "@/lib/env";

type SandboxEnvSnapshot = {
  standard: string | undefined;
  legacy: string | undefined;
};

function assertSafeTaskId(taskId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(taskId)) {
    throw new Error("Invalid taskId");
  }
}

function restoreDbOverrideEnv(prev: SandboxEnvSnapshot): void {
  if (prev.standard === undefined) {
    delete process.env.DB_OVERRIDE;
  } else {
    process.env.DB_OVERRIDE = prev.standard;
  }

  if (prev.legacy === undefined) {
    delete process.env.DB_OVER_RIDE;
  } else {
    process.env.DB_OVER_RIDE = prev.legacy;
  }
}

export async function runSandbox(taskId: string): Promise<void> {
  assertSafeTaskId(taskId);

  const instanceId = requireEnv("SPANNER_INSTANCE_ID");
  const prev: SandboxEnvSnapshot = {
    standard: process.env.DB_OVERRIDE,
    legacy: process.env.DB_OVER_RIDE,
  };
  const sandboxDb = `sandbox_${taskId.replace(/-/g, "_")}`;
  let dbCreated = false;

  try {
    execFileSync("gcloud", ["spanner", "databases", "create", sandboxDb, `--instance=${instanceId}`], {
      stdio: "inherit",
    });
    dbCreated = true;

    process.env.DB_OVERRIDE = sandboxDb;
    delete process.env.DB_OVER_RIDE;
  } finally {
    restoreDbOverrideEnv(prev);

    if (dbCreated) {
      execFileSync("gcloud", ["spanner", "databases", "delete", sandboxDb, `--instance=${instanceId}`, "--quiet"], {
        stdio: "inherit",
      });
    }
  }
}
