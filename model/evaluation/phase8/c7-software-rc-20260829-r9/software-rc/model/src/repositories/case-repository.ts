import type { CasePackage } from "../domain/case-package.js";

export interface CaseRepository {
  findByPublicId(publicCaseId: string): CasePackage | undefined;
  findByPublicIdAndVersion(
    publicCaseId: string,
    caseVersion: string,
  ): CasePackage | undefined;
}

export class InMemoryCaseRepository implements CaseRepository {
  private readonly currentByPublicId = new Map<string, CasePackage>();
  private readonly byPublicIdAndVersion = new Map<string, CasePackage>();

  constructor(cases: CasePackage[]) {
    for (const casePackage of cases) {
      const stored = structuredClone(casePackage);
      this.currentByPublicId.set(stored.publicCaseId, stored);
      this.byPublicIdAndVersion.set(
        this.versionKey(stored.publicCaseId, stored.caseVersion),
        stored,
      );
    }
  }

  findByPublicId(publicCaseId: string): CasePackage | undefined {
    const casePackage = this.currentByPublicId.get(publicCaseId);
    return casePackage ? structuredClone(casePackage) : undefined;
  }

  findByPublicIdAndVersion(
    publicCaseId: string,
    caseVersion: string,
  ): CasePackage | undefined {
    const casePackage = this.byPublicIdAndVersion.get(
      this.versionKey(publicCaseId, caseVersion),
    );
    return casePackage ? structuredClone(casePackage) : undefined;
  }

  private versionKey(publicCaseId: string, caseVersion: string): string {
    return JSON.stringify([publicCaseId, caseVersion]);
  }
}
