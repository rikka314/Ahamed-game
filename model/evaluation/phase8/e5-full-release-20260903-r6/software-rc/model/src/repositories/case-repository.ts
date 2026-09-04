import type { SupportedCasePackage } from "../domain/case-package.js";

export interface CaseRepository {
  findByPublicId(publicCaseId: string): SupportedCasePackage | undefined;
  findByPublicIdAndVersion(
    publicCaseId: string,
    caseVersion: string,
  ): SupportedCasePackage | undefined;
}

export class InMemoryCaseRepository implements CaseRepository {
  private readonly currentByPublicId = new Map<string, SupportedCasePackage>();
  private readonly byPublicIdAndVersion = new Map<string, SupportedCasePackage>();

  constructor(cases: SupportedCasePackage[]) {
    for (const casePackage of cases) {
      const stored = structuredClone(casePackage);
      this.currentByPublicId.set(stored.publicCaseId, stored);
      this.byPublicIdAndVersion.set(
        this.versionKey(stored.publicCaseId, stored.caseVersion),
        stored,
      );
    }
  }

  findByPublicId(publicCaseId: string): SupportedCasePackage | undefined {
    const casePackage = this.currentByPublicId.get(publicCaseId);
    return casePackage ? structuredClone(casePackage) : undefined;
  }

  findByPublicIdAndVersion(
    publicCaseId: string,
    caseVersion: string,
  ): SupportedCasePackage | undefined {
    const casePackage = this.byPublicIdAndVersion.get(
      this.versionKey(publicCaseId, caseVersion),
    );
    return casePackage ? structuredClone(casePackage) : undefined;
  }

  private versionKey(publicCaseId: string, caseVersion: string): string {
    return JSON.stringify([publicCaseId, caseVersion]);
  }
}
