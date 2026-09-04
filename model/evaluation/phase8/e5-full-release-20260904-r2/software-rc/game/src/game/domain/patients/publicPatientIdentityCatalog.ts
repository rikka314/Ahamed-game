import {
  PUBLIC_ID_PATTERN_V1,
  type PatientRoleIdV1,
} from "@ahamed/doctor-game-share";

export const EXPECTED_LAUNCH_PATIENT_ROLE_COUNT = 30;

export type PublicPatientIdentity = {
  patientRoleId: PatientRoleIdV1;
  appearanceVariantId: string;
  portraitAssetId: string;
  sprite: {
    standingTextureKey: string;
    seatedTextureKey: string;
    tint: number;
  };
};

const PUBLIC_PATIENT_IDENTITIES = [
  identity(1, 1, 0xd96570),
  identity(2, 2, 0x4f86c6),
  identity(3, 1, 0xd18f3f),
  identity(4, 2, 0x6a9f5b),
  identity(5, 1, 0x9a6bc4),
  identity(6, 2, 0xc06c84),
  identity(7, 1, 0x4e9b93),
  identity(8, 2, 0xb56a45),
  identity(9, 1, 0x7a86c7),
  identity(10, 2, 0x579a6d),
  identity(11, 1, 0xc77c3d),
  identity(12, 2, 0x5d7fb8),
  identity(13, 1, 0x9b725c),
  identity(14, 2, 0x5a9aa8),
  identity(15, 1, 0xb65a6f),
  identity(16, 2, 0x7e9b4e),
  identity(17, 1, 0x8c6cc2),
  identity(18, 2, 0xc58a4b),
  identity(19, 1, 0x4f8f7a),
  identity(20, 2, 0xa8698f),
  identity(21, 1, 0x687fb0),
  identity(22, 2, 0xc26f5a),
  identity(23, 1, 0x699d55),
  identity(24, 2, 0x8f72b5),
  identity(25, 1, 0xd08a62),
  identity(26, 2, 0x4f929d),
  identity(27, 1, 0xb75f86),
  identity(28, 2, 0x7d9652),
  identity(29, 1, 0x766fc0),
  identity(30, 2, 0xca7650),
] as const satisfies readonly PublicPatientIdentity[];

const patientIdentityIndex = createPublicPatientIdentityIndex(
  PUBLIC_PATIENT_IDENTITIES,
  EXPECTED_LAUNCH_PATIENT_ROLE_COUNT,
);

export function createPublicPatientIdentityIndex(
  entries: readonly PublicPatientIdentity[],
  expectedCount?: number,
): ReadonlyMap<PatientRoleIdV1, PublicPatientIdentity> {
  if (expectedCount !== undefined && entries.length !== expectedCount) {
    throw new Error(
      `Patient identity catalog must contain ${expectedCount} entries; received ${entries.length}.`,
    );
  }

  const index = new Map<PatientRoleIdV1, PublicPatientIdentity>();
  const appearanceVariantIds = new Set<string>();
  const tints = new Set<number>();
  const idPattern = new RegExp(PUBLIC_ID_PATTERN_V1, "u");

  for (const entry of entries) {
    if (!idPattern.test(entry.patientRoleId)) {
      throw new Error(`Invalid patientRoleId in identity catalog: ${entry.patientRoleId}`);
    }
    if (index.has(entry.patientRoleId)) {
      throw new Error(`Duplicate patientRoleId in identity catalog: ${entry.patientRoleId}`);
    }
    if (appearanceVariantIds.has(entry.appearanceVariantId)) {
      throw new Error(
        `Duplicate appearanceVariantId in identity catalog: ${entry.appearanceVariantId}`,
      );
    }
    if (tints.has(entry.sprite.tint)) {
      throw new Error(`Duplicate sprite tint in identity catalog: ${entry.sprite.tint}`);
    }
    for (const assetId of [
      entry.portraitAssetId,
      entry.sprite.standingTextureKey,
      entry.sprite.seatedTextureKey,
    ]) {
      if (!idPattern.test(assetId)) {
        throw new Error(`Invalid public asset ID in identity catalog: ${assetId}`);
      }
    }
    if (!Number.isInteger(entry.sprite.tint) || entry.sprite.tint < 0 || entry.sprite.tint > 0xffffff) {
      throw new Error(`Invalid sprite tint in identity catalog: ${entry.sprite.tint}`);
    }

    appearanceVariantIds.add(entry.appearanceVariantId);
    tints.add(entry.sprite.tint);
    index.set(entry.patientRoleId, cloneIdentity(entry));
  }

  return index;
}

export function listPublicPatientIdentities(): PublicPatientIdentity[] {
  return [...patientIdentityIndex.values()].map(cloneIdentity);
}

export function resolvePublicPatientIdentity(
  patientRoleId: string,
): PublicPatientIdentity {
  const identity = patientIdentityIndex.get(patientRoleId as PatientRoleIdV1);
  if (!identity) {
    throw new Error(`Unknown patientRoleId in public identity catalog: ${patientRoleId}`);
  }
  return cloneIdentity(identity);
}

export function assertPublicPatientIdentityAssets(
  identity: PublicPatientIdentity,
  hasAsset: (assetId: string) => boolean,
): void {
  const assetIds = new Set([
    identity.portraitAssetId,
    identity.sprite.standingTextureKey,
    identity.sprite.seatedTextureKey,
  ]);
  for (const assetId of assetIds) {
    if (!hasAsset(assetId)) {
      throw new Error(
        `Missing public patient asset ${assetId} for ${identity.patientRoleId}.`,
      );
    }
  }
}

function identity(
  sequence: number,
  baseTexture: 1 | 2,
  tint: number,
): PublicPatientIdentity {
  const code = String(sequence).padStart(2, "0");
  return {
    patientRoleId: `patient-role.public-c${code}` as PatientRoleIdV1,
    appearanceVariantId: `patient-appearance.public-c${code}`,
    portraitAssetId: `patient-placeholder-0${baseTexture}`,
    sprite: {
      standingTextureKey: `patient-placeholder-0${baseTexture}`,
      seatedTextureKey: `patient-seated-placeholder-0${baseTexture}`,
      tint,
    },
  };
}

function cloneIdentity(identity: PublicPatientIdentity): PublicPatientIdentity {
  return {
    ...identity,
    sprite: { ...identity.sprite },
  };
}
