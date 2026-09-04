import type { ClientRequestIdV1, DeviceIdV1, TestIdV1 } from "./ids.js";

export const TEST_STATUSES_V1 = ["unavailable", "pending", "completed"] as const;
export type TestStatusV1 = (typeof TEST_STATUSES_V1)[number];

export type TestRequestV1 = { clientRequestId: ClientRequestIdV1; testId: TestIdV1; deviceId?: DeviceIdV1 };
export type TestResultV1 = {
  testId: TestIdV1;
  status: TestStatusV1;
  report?: string;
  assetId?: string;
  completedAt?: string;
  reasonCode?: string;
};
