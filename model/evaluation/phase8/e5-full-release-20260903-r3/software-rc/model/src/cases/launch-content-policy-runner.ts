import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  createLaunchContentPolicyQualityRecord,
  loadLaunchContentPolicy,
  type LaunchContentPolicyQualityRecord,
} from "./launch-content-policy.js";

const qualityRecordPath = fileURLToPath(
  new URL(
    "../../../cases/policy/launch-content-policy-e0-quality-record.v1.json",
    import.meta.url,
  ),
);
const persisted = JSON.parse(
  readFileSync(qualityRecordPath, "utf8"),
) as LaunchContentPolicyQualityRecord;
const computed = createLaunchContentPolicyQualityRecord(
  loadLaunchContentPolicy(),
  persisted.recordedAt,
);

if (JSON.stringify(computed) !== JSON.stringify(persisted)) {
  throw new Error("E0 quality record is stale or does not match the frozen policy");
}

process.stdout.write(`${JSON.stringify(computed, null, 2)}\n`);
