// One-process deploy for free hosts (one web service, no separate worker, no shell):
//   1. apply database migrations
//   2. run the API and the worker side by side
// If either stops, stop the other and exit, so the host restarts the whole service.
// Usage: npm run start:all
import { spawn, spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const migrate = spawnSync(npm, ["run", "db:deploy"], { stdio: "inherit", shell: process.platform === "win32" });
if (migrate.status !== 0) {
  console.error("database migration failed, not starting");
  process.exit(migrate.status ?? 1);
}

const children = ["start:api", "start:worker"].map((script) =>
  spawn(npm, ["run", script], { stdio: "inherit", shell: process.platform === "win32" }),
);

let stopping = false;
const stopAll = (code) => {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 10_000).unref();
};

for (const c of children) {
  c.on("exit", (code) => {
    if (!stopping) console.error(`a process exited (code ${code}), stopping the service`);
    stopAll(code ?? 1);
    if (children.every((x) => x.exitCode !== null || x.signalCode !== null)) process.exit(code ?? 1);
  });
}
process.on("SIGTERM", () => stopAll(0));
process.on("SIGINT", () => stopAll(0));
