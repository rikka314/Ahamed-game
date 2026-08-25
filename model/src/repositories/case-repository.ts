import type { CasePackage } from "../domain/case-package.js";

export interface CaseRepository {
  findByPublicId(publicCaseId: string): CasePackage | undefined;
}

export class InMemoryCaseRepository implements CaseRepository {
  private readonly byPublicId: Map<string, CasePackage>;

  constructor(cases: CasePackage[]) {
    this.byPublicId = new Map(
      cases.map((casePackage) => [
        casePackage.publicCaseId,
        structuredClone(casePackage),
      ]),
    );
  }

  findByPublicId(publicCaseId: string): CasePackage | undefined {
    const casePackage = this.byPublicId.get(publicCaseId);
    return casePackage ? structuredClone(casePackage) : undefined;
  }
}
