import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = mkdtempSync(join(tmpdir(), "rekindle-package-check-"));

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf-8",
    stdio: "pipe",
    env: {
      ...process.env,
      npm_config_cache: join(workspace, "npm-cache"),
      npm_config_update_notifier: "false",
    },
  });
}

try {
  const packDir = join(workspace, "pack");
  const projectDir = join(workspace, "project");
  mkdirSync(packDir);
  mkdirSync(projectDir);

  run("npm", ["pack", "--pack-destination", packDir], repoRoot);
  const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected one package tarball, found ${tarballs.length}`);
  }

  const tarball = join(packDir, tarballs[0]);
  run("npm", ["init", "-y"], projectDir);
  run("npm", ["install", "--no-audit", "--no-fund", tarball], projectDir);

  const cli = join(projectDir, "node_modules", "rekindle", "dist", "init", "cli.js");
  run(process.execPath, [cli, "init"], projectDir);

  const settingsPath = join(projectDir, ".claude", "settings.local.json");
  if (existsSync(settingsPath)) {
    throw new Error("Plain `rekindle init` modified Claude settings; hook installation must be opt-in");
  }

  run(process.execPath, [cli, "init", "--with-hooks"], projectDir);
  if (!existsSync(settingsPath)) {
    throw new Error("`rekindle init --with-hooks` did not create Claude hook settings");
  }

  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const groups = settings?.hooks?.PreCompact;
  if (!Array.isArray(groups) || groups.length !== 2) {
    throw new Error("Packaged PreCompact configuration must contain auto and manual matcher groups");
  }

  const matchers = groups.map((group) => group.matcher).sort();
  if (matchers.join(",") !== "auto,manual") {
    throw new Error(`Unexpected packaged PreCompact matchers: ${matchers.join(",")}`);
  }

  for (const group of groups) {
    const hook = group.hooks?.[0];
    if (hook?.command !== "npx rekindle precompact-capture" || hook?.timeout !== 60) {
      throw new Error("Packaged hook command or timeout does not match the documented contract");
    }
  }

  run(process.execPath, [cli, "setup-delivery"], projectDir);
  const deliverySettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  const sessionStartGroups = deliverySettings?.hooks?.SessionStart;
  if (!Array.isArray(sessionStartGroups) || sessionStartGroups.length !== 1) {
    throw new Error("Packaged SessionStart configuration must contain one matcher group");
  }

  const deliveryGroup = sessionStartGroups[0];
  const deliveryHook = deliveryGroup?.hooks?.[0];
  if (
    deliveryGroup?.matcher !== "startup|resume|clear|compact" ||
    deliveryHook?.command !== "npx rekindle session-start" ||
    deliveryHook?.timeout !== 60
  ) {
    throw new Error("Packaged SessionStart hook does not match the documented contract");
  }

  const installedRoot = join(projectDir, "node_modules", "rekindle");
  const installedPackage = JSON.parse(
    readFileSync(join(installedRoot, "package.json"), "utf-8")
  );
  const initializeRequest = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "package-verifier", version: "1" },
    },
  });
  const initializeOutput = execFileSync(
    process.execPath,
    [join(installedRoot, "dist", "index.js")],
    {
      cwd: projectDir,
      input: `${initializeRequest}\n`,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        REKINDLE_BASE_DIR: projectDir,
      },
    }
  );
  const initializeResponse = JSON.parse(initializeOutput.trim().split("\n")[0]);
  const reportedVersion = initializeResponse?.result?.serverInfo?.version;
  if (reportedVersion !== installedPackage.version) {
    throw new Error(
      `Packed MCP version ${reportedVersion ?? "<missing>"} does not match package version ${installedPackage.version}`
    );
  }

  console.log(
    "Package verification passed: init is opt-in, packed hook schemas match source, and MCP metadata matches the package version."
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
