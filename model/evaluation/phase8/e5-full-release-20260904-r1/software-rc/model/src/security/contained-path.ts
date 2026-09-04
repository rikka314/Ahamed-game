import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function assertInside(
  realRoot: string,
  realPath: string,
  label: string,
  allowRoot = false,
): void {
  const rel = relative(realRoot, realPath);
  if (
    (!allowRoot && rel === "") || rel === ".." || rel.startsWith(`..${sep}`) ||
    isAbsolute(rel)
  ) {
    throw new Error(`${label} realpath escapes its declared root.`);
  }
}

function validatePortablePath(portablePath: string, label: string): string[] {
  if (
    portablePath.length === 0 || isAbsolute(portablePath) ||
    portablePath.includes("\\") || /^[A-Za-z]:/u.test(portablePath)
  ) {
    throw new Error(`${label} must be a portable relative path.`);
  }
  const segments = portablePath.split("/");
  if (segments.some((segment) =>
    segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${label} contains an unsafe path segment.`);
  }
  return segments;
}

export function resolveContainedPathForCreate(
  root: string,
  portablePath: string,
  label: string,
): string {
  const realRoot = realpathSync(root);
  const candidate = resolve(realRoot, ...validatePortablePath(portablePath, label));
  const lexicalRelative = relative(realRoot, candidate);
  if (
    lexicalRelative === "" || lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..${sep}`) || isAbsolute(lexicalRelative)
  ) {
    throw new Error(`${label} escapes its declared root.`);
  }
  let existingParent = dirname(candidate);
  while (!existsSync(existingParent)) {
    const nextParent = dirname(existingParent);
    if (nextParent === existingParent) {
      throw new Error(`${label} has no resolvable existing parent.`);
    }
    existingParent = nextParent;
  }
  const realParent = realpathSync(existingParent);
  assertInside(realRoot, realParent, label, true);
  if (!lstatSync(realParent).isDirectory()) {
    throw new Error(`${label} existing parent must be a directory.`);
  }
  return candidate;
}

export function resolveContainedRegularFile(
  root: string,
  portablePath: string,
  label: string,
): string {
  const candidate = resolveContainedPathForCreate(root, portablePath, label);
  return assertContainedRegularFile(root, candidate, label);
}

export function resolveContainedDirectory(
  root: string,
  portablePath: string,
  label: string,
): string {
  const candidate = resolveContainedPathForCreate(root, portablePath, label);
  return assertContainedDirectory(root, candidate, label);
}

export function assertContainedRegularFile(
  root: string,
  candidate: string,
  label: string,
): string {
  if (!existsSync(candidate)) throw new Error(`${label} is missing.`);
  const stats = lstatSync(candidate);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  const realRoot = realpathSync(root);
  const realCandidate = realpathSync(candidate);
  assertInside(realRoot, realCandidate, label);
  return realCandidate;
}

export function assertContainedDirectory(
  root: string,
  candidate: string,
  label: string,
): string {
  if (!existsSync(candidate)) throw new Error(`${label} is missing.`);
  const stats = lstatSync(candidate);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory.`);
  }
  const realRoot = realpathSync(root);
  const realCandidate = realpathSync(candidate);
  assertInside(realRoot, realCandidate, label);
  return realCandidate;
}

function retryableRename(source: string, destination: string): void {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      renameSync(source, destination);
      return;
    } catch (error) {
      lastError = error;
      const code = error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (
        !["EPERM", "EACCES", "EBUSY"].includes(code) ||
        attempt === 7
      ) {
        throw error;
      }
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        Math.min(50 * (2 ** attempt), 400),
      );
    }
  }
  throw lastError;
}

export function publishDirectoryExclusive(
  source: string,
  destination: string,
): void {
  const sourceStats = lstatSync(source);
  if (sourceStats.isSymbolicLink() || !sourceStats.isDirectory()) {
    throw new Error("Publication source must be a non-symlink directory.");
  }
  let claimedDestination = false;
  if (process.platform !== "win32") {
    mkdirSync(destination, { recursive: false });
    claimedDestination = true;
  }
  try {
    retryableRename(source, destination);
  } catch (error) {
    if (
      claimedDestination && existsSync(destination) &&
      !lstatSync(destination).isSymbolicLink() &&
      lstatSync(destination).isDirectory() &&
      readdirSync(destination).length === 0
    ) {
      rmdirSync(destination);
    }
    throw error;
  }
}

export function publishFileExclusive(
  source: string,
  destination: string,
): void {
  const sourceStats = lstatSync(source);
  if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
    throw new Error("Publication source must be a regular non-symlink file.");
  }
  linkSync(source, destination);
  unlinkSync(source);
}
