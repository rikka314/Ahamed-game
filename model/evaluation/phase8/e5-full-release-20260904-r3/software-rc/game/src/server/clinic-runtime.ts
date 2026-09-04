import "server-only";

import { resolve } from "node:path";

import {
  createWebModelRuntime,
  loadWebPublicCases,
  resolvePackagedWebModelRoot,
  type WebPublicCase,
  type WebModelRuntime,
} from "@ahamed/doctor-game-model";

const configuredModelRoot = process.env["DOCTOR_GAME_MODEL_ROOT"]?.trim();
const modelRoot = configuredModelRoot
  ? resolve(/* turbopackIgnore: true */ configuredModelRoot)
  : process.env.NODE_ENV === "production"
    ? resolvePackagedWebModelRoot()
    : resolve(process.cwd(), "..", "model");

const runtimeGlobal = globalThis as typeof globalThis & {
  __ahamedDoctorRuntime?: WebModelRuntime;
  __ahamedClinicPublicCases?: readonly WebPublicCase[];
};

export function getClinicRuntime(): WebModelRuntime {
  runtimeGlobal.__ahamedDoctorRuntime ??= createWebModelRuntime({ modelRoot });
  runtimeGlobal.__ahamedDoctorRuntime.maintain();
  return runtimeGlobal.__ahamedDoctorRuntime;
}

export function getClinicPublicCases() {
  runtimeGlobal.__ahamedClinicPublicCases ??= Object.freeze(
    loadWebPublicCases(modelRoot).map((item) => Object.freeze(item)),
  );
  return runtimeGlobal.__ahamedClinicPublicCases;
}
