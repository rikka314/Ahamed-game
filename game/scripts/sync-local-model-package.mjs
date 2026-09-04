import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const gameRoot = resolve(import.meta.dirname, "..");
const modelRoot = resolve(gameRoot, "../model");
const packageScopeRoot = resolve(gameRoot, "node_modules/@ahamed");
const installedRoot = resolve(packageScopeRoot, "doctor-game-model");
const syncToken = `${process.pid}-${randomUUID()}`;
const stagingRoot = resolve(packageScopeRoot, `.doctor-game-model-sync-${syncToken}`);
const backupRoot = resolve(packageScopeRoot, `.doctor-game-model-backup-${syncToken}`);
const lockRoot = resolve(packageScopeRoot, ".doctor-game-model-sync.lock");
const lockOwnerPath = resolve(lockRoot, "owner.json");
const npmCli = process.env.npm_execpath;
const lockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));
const lockTimeoutMs = 120_000;
const ownerWriteGraceMs = 120_000;

if (typeof npmCli !== "string" || npmCli.length === 0) {
  throw new Error("sync:local-model must be launched through npm.");
}

function assertSafePackagePath(path) {
  const relativePath = relative(gameRoot, path);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath) ||
    !relativePath.startsWith(`node_modules${sep}@ahamed`)
  ) {
    throw new Error(`Refusing to sync outside the game package: ${path}`);
  }
}

for (const path of [installedRoot, stagingRoot, backupRoot, lockRoot]) {
  assertSafePackagePath(path);
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && error.code === "ESRCH");
  }
}

function lockIsStale() {
  try {
    const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
    if (Number.isInteger(owner.pid) && owner.pid > 0) {
      return !processIsAlive(owner.pid);
    }
  } catch {
    // Fall through to the age check while a new owner file may be appearing.
  }
  try {
    return Date.now() - statSync(lockRoot).mtimeMs > ownerWriteGraceMs;
  } catch {
    return false;
  }
}

function acquireSyncLock() {
  const deadline = Date.now() + lockTimeoutMs;
  while (true) {
    let created = false;
    try {
      mkdirSync(lockRoot);
      created = true;
      writeFileSync(
        lockOwnerPath,
        `${JSON.stringify({ pid: process.pid, token: syncToken })}\n`,
        "utf8",
      );
      return;
    } catch (error) {
      if (created) {
        rmSync(lockRoot, { recursive: true, force: true });
        throw error;
      }
      if (!(error && typeof error === "object" && error.code === "EEXIST")) {
        throw error;
      }
    }

    if (lockIsStale()) {
      const staleRoot = resolve(
        packageScopeRoot,
        `.doctor-game-model-stale-lock-${syncToken}`,
      );
      assertSafePackagePath(staleRoot);
      try {
        renameSync(lockRoot, staleRoot);
        rmSync(staleRoot, { recursive: true, force: true });
        continue;
      } catch {
        // Another process either reclaimed or released the lock first.
      }
    }

    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the local model sync lock.");
    }
    Atomics.wait(lockWaitBuffer, 0, 0, 200);
  }
}

function releaseSyncLock() {
  try {
    const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
    if (owner.token === syncToken) {
      rmSync(lockRoot, { recursive: true, force: true });
    }
  } catch {
    // Preserve an uncertain lock. A later process can reclaim it after exit.
  }
}

acquireSyncLock();
let backupCreated = false;
let installedByThisProcess = false;
try {
  execFileSync(process.execPath, [npmCli, "run", "build"], {
    cwd: modelRoot,
    stdio: "inherit",
  });

  mkdirSync(stagingRoot, { recursive: true });
  for (const [source, destination] of [
    ["package.json", "package.json"],
    ["README.md", "README.md"],
    ["dist/src", "dist/src"],
    ["cases", "cases"],
    ["prompts", "prompts"],
  ]) {
    cpSync(resolve(modelRoot, source), resolve(stagingRoot, destination), {
      recursive: true,
    });
  }

  try {
    if (existsSync(installedRoot)) {
      renameSync(installedRoot, backupRoot);
      backupCreated = true;
    }
    renameSync(stagingRoot, installedRoot);
    installedByThisProcess = true;

    const sourcePackage = JSON.parse(
      readFileSync(resolve(modelRoot, "package.json"), "utf8"),
    );
    const installedPackage = JSON.parse(
      readFileSync(resolve(installedRoot, "package.json"), "utf8"),
    );
    if (installedPackage.version !== sourcePackage.version) {
      throw new Error(
        `Installed model ${installedPackage.version} does not match source ${sourcePackage.version}.`,
      );
    }

    const sourceEntry = resolve(
      modelRoot,
      "dist/src/application/model-service.js",
    );
    const installedEntry = resolve(
      installedRoot,
      "dist/src/application/model-service.js",
    );
    const sha256 = (path) =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    if (sha256(installedEntry) !== sha256(sourceEntry)) {
      throw new Error("Installed model build does not match the source build.");
    }
  } catch (error) {
    if (installedByThisProcess && existsSync(installedRoot)) {
      rmSync(installedRoot, { recursive: true, force: true });
      installedByThisProcess = false;
    }
    if (backupCreated && existsSync(backupRoot)) {
      try {
        renameSync(backupRoot, installedRoot);
        backupCreated = false;
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Local model sync failed and the backup was preserved at ${backupRoot}.`,
        );
      }
    }
    throw error;
  }

  if (backupCreated) {
    try {
      rmSync(backupRoot, { recursive: true, force: true });
      backupCreated = false;
    } catch (error) {
      console.warn(
        `Local model sync succeeded, but its backup was preserved at ${backupRoot}:`,
        error,
      );
    }
  }
} finally {
  rmSync(stagingRoot, { recursive: true, force: true });
  releaseSyncLock();
}
