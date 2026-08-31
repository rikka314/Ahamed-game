import { createHash } from "node:crypto";

import type { CommunicationAssessment } from "../evaluation/scoring-policy-v1.js";
import type { ModelProviderIdentity } from "./model-provider.js";

export interface CommunicationReviewInput {
  turnIds: readonly string[];
  rubricCriterionIds: readonly string[];
}

export interface CommunicationReviewProvider {
  readonly identity: ModelProviderIdentity;
  review(input: CommunicationReviewInput): Promise<CommunicationAssessment>;
}

export interface LabeledFixtureCommunicationAssessment {
  score: 0 | 50 | 100;
  supportingTurnIndexes: number[];
  rubricCriterionIds: string[];
}

/** Explicit test-only labels; this provider does not infer communication quality. */
export class LabeledFixtureCommunicationReviewProvider
  implements CommunicationReviewProvider
{
  readonly identity: ModelProviderIdentity;
  private readonly label: LabeledFixtureCommunicationAssessment;

  constructor(label: LabeledFixtureCommunicationAssessment) {
    this.label = structuredClone(label);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(this.label))
      .digest("hex")
      .slice(0, 16);
    this.identity = Object.freeze({
      providerName: "labeled-fixture-communication-review",
      modelId: "labeled-fixture-v1",
      promptVersion: `fixture-label-${fingerprint}`,
    });
  }

  async review(
    input: CommunicationReviewInput,
  ): Promise<CommunicationAssessment> {
    const supportingTurnIds = this.label.supportingTurnIndexes.map((index) => {
      const turnId = input.turnIds[index];
      if (turnId === undefined) {
        throw new RangeError(`Fixture communication label references missing turn index ${index}`);
      }
      return turnId;
    });

    return {
      status: "available",
      score: this.label.score,
      supportingTurnIds,
      rubricCriterionIds: [...this.label.rubricCriterionIds],
    };
  }
}
