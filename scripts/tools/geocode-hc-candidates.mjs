import { spawnSync } from "child_process";

const result = spawnSync(
  process.execPath,
  [
    "--experimental-strip-types",
    "--import",
    "./scripts/tests/register-node-ts-resolver.mjs",
    "scripts/tools/geocode-hc-candidates-worker.ts",
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

process.exitCode = result.status ?? 1;
