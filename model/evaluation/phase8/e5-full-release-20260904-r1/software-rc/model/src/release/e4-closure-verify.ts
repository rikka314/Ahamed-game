import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  verifyE4PatientIdentityClosure,
  type E4PatientIdentityClosure,
} from "./e4-closure.js";
import { resolveContainedRegularFile } from "../security/contained-path.js";

function resolveClosure(gameRoot: string, requestedPath: string): string {
  if (!/^share\/versions\/e4-patient-identity-e5-closure[A-Za-z0-9._-]*\.json$/u.test(requestedPath)) {
    throw new Error("--closure must be a canonical E4 closure path under share/versions/.");
  }
  return resolveContainedRegularFile(gameRoot, requestedPath, "E4 closure");
}

function main(): void {
  try {
    const argv = process.argv.slice(2);
    if (argv.length !== 2 || argv[0] !== "--closure") {
      throw new Error("Usage: e4-closure-verify --closure <project-relative-json>");
    }
    const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const gameRoot = resolve(modelRoot, "..");
    const closurePath = resolveClosure(gameRoot, argv[1]!);
    const closure = JSON.parse(
      readFileSync(closurePath, "utf8"),
    ) as E4PatientIdentityClosure;
    const result = verifyE4PatientIdentityClosure({ gameRoot, closure });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `E4 closure verification failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
