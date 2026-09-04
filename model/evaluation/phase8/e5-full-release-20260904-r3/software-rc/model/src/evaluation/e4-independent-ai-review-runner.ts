import { randomUUID } from "node:crypto";
import { existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OfficialOpenAIResponsesTransport,
  OpenAICompatibleResponsesTransport,
} from "../providers/openai-model-provider.js";
import { resolveOpenAIRuntimeConfig } from "../providers/openai-runtime-config.js";
import { ModelProviderRequestError } from "../providers/model-provider.js";
import {
  assertContainedRegularFile,
  resolveContainedPathForCreate,
  resolveContainedRegularFile,
} from "../security/contained-path.js";
import { canonicalJson } from "./e4-cross-layer-evidence.js";
import {
  E4_REVIEWER_IDS,
  runE4IndependentAiReview,
  type E4ReviewerId,
} from "./e4-independent-ai-review.js";

interface Arguments {
  reviewerId: E4ReviewerId;
  inputPath: string;
  outputPath: string;
  modelId: string;
}

function parseArguments(argv: readonly string[], environment: NodeJS.ProcessEnv): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === undefined || value === undefined || !["--role", "--input", "--output", "--model"].includes(key)) {
      throw new Error(`Unknown or incomplete E4 AI review argument: ${key ?? ""}`);
    }
    if (values.has(key)) throw new Error(`Duplicate E4 AI review argument: ${key}`);
    values.set(key, value);
  }
  const reviewerId = values.get("--role");
  const inputPath = values.get("--input");
  const outputPath = values.get("--output");
  const modelId = values.get("--model") ?? environment["AHAMED_MODEL_ID"]?.trim();
  if (!E4_REVIEWER_IDS.includes(reviewerId as E4ReviewerId) || inputPath === undefined || outputPath === undefined || modelId === undefined || modelId.length === 0) {
    throw new Error("E4 AI review requires --role, --input, --output and --model (or AHAMED_MODEL_ID).");
  }
  return { reviewerId: reviewerId as E4ReviewerId, inputPath, outputPath, modelId };
}

function assertPrivateEvidencePath(path: string, label: string): void {
  if (!/^evaluation\/phase8\/[A-Za-z0-9._/-]+\/private\/[A-Za-z0-9._-]+\.json$/u.test(path)) {
    throw new Error(`${label} must stay under an E4 private evidence directory.`);
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2), process.env);
  const modelRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  assertPrivateEvidencePath(args.inputPath, "review input");
  assertPrivateEvidencePath(args.outputPath, "review output");
  const inputPath = resolveContainedRegularFile(modelRoot, args.inputPath, "E4 review input");
  const outputPath = resolveContainedPathForCreate(modelRoot, args.outputPath, "E4 review output");
  if (existsSync(outputPath)) throw new Error("E4 review output exists; refusing to overwrite immutable evidence.");
  const runtime = resolveOpenAIRuntimeConfig(process.env);
  const transport = runtime.isOfficial
    ? new OfficialOpenAIResponsesTransport({ apiKey: runtime.apiKey })
    : new OpenAICompatibleResponsesTransport({ apiKey: runtime.apiKey, baseURL: runtime.baseURL });
  const reviewTarget = JSON.parse(readFileSync(inputPath, "utf8")) as unknown;
  const review = await runE4IndependentAiReview({
    reviewerId: args.reviewerId,
    reviewTarget,
    transport,
    modelId: args.modelId,
  });
  const temporaryPath = `${outputPath}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, canonicalJson(review), { encoding: "utf8", flag: "wx" });
    assertContainedRegularFile(modelRoot, temporaryPath, "E4 temporary review output");
    resolveContainedPathForCreate(modelRoot, args.outputPath, "E4 review output");
    linkSync(temporaryPath, outputPath);
    assertContainedRegularFile(modelRoot, outputPath, "E4 final review output");
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
  process.stdout.write(canonicalJson({ reviewerId: review.reviewerId, decision: review.decision, modelId: review.modelId, outputPath: args.outputPath }));
}

void main().catch((error: unknown) => {
  if (error instanceof ModelProviderRequestError) {
    process.stderr.write(canonicalJson({
      error: "ModelProviderRequestError",
      code: error.code,
      retryable: error.retryable,
      status: error.status ?? null,
      providerRequestId: error.providerRequestId ?? null,
    }));
  } else {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
