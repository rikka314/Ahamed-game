export type OpaqueIdV1<TName extends string> = string & { readonly __opaqueId: TName };

export type GameProfileIdV1 = OpaqueIdV1<"GameProfileId">;
export type UserIdV1 = OpaqueIdV1<"UserId">;
export type SessionIdV1 = OpaqueIdV1<"SessionId">;
export type CaseIdV1 = OpaqueIdV1<"CaseId">;
export type CaseVersionV1 = OpaqueIdV1<"CaseVersion">;
export type NpcIdV1 = OpaqueIdV1<"NpcId">;
export type PatientRoleIdV1 = OpaqueIdV1<"PatientRoleId">;
export type InteractionIdV1 = OpaqueIdV1<"InteractionId">;
export type LocationIdV1 = OpaqueIdV1<"LocationId">;
export type FactIdV1 = OpaqueIdV1<"FactId">;
export type TestIdV1 = OpaqueIdV1<"TestId">;
export type DeviceIdV1 = OpaqueIdV1<"DeviceId">;
export type CriterionIdV1 = OpaqueIdV1<"CriterionId">;
export type ClientTurnIdV1 = OpaqueIdV1<"ClientTurnId">;
export type ClientRequestIdV1 = OpaqueIdV1<"ClientRequestId">;
export type TurnIdV1 = OpaqueIdV1<"TurnId">;
export type SubmissionIdV1 = OpaqueIdV1<"SubmissionId">;
export type EvaluationIdV1 = OpaqueIdV1<"EvaluationId">;
export type EventIdV1 = OpaqueIdV1<"EventId">;
export type TraceIdV1 = OpaqueIdV1<"TraceId">;

export const PUBLIC_ID_PATTERN_V1 = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$";
