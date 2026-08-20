import "server-only";

import { createHash } from "crypto";
import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
  DeleteCollectionCommand,
} from "@aws-sdk/client-rekognition";

/**
 * Face matching for kiosk punch — the ONLY file that talks to AWS
 * Rekognition. Everything the client (kiosk tablet / phone) does goes
 * through our own API routes, which call this; the browser never touches
 * AWS. What AWS ever holds: face images at index/search time and derived
 * templates, keyed by opaque UUIDs (tenant id, employee id) — no names,
 * no employee data. The provider is deliberately replaceable: enrollment
 * photos are kept in OUR private `wfm` bucket, so a future engine swap
 * re-enrolls from stored photos without any employee re-scanning
 * (Rekognition templates cannot be exported).
 *
 * Env — custom names because Vercel reserves the standard AWS_* variables
 * for its own Lambda runtime:
 *   FACE_AWS_ACCESS_KEY_ID / FACE_AWS_SECRET_ACCESS_KEY / FACE_AWS_REGION
 * The IAM user behind the key needs rekognition:{CreateCollection,
 * IndexFaces, SearchFacesByImage, DeleteFaces, DeleteCollection} and
 * nothing else. Region should be ap-south-1 (Mumbai) so biometric data
 * stays in India.
 */

// Kiosk punch pairs the match with a human confirm tap, so the threshold
// favors "no match" over a wrong name: at <=100 faces per collection, 95
// is far above any plausible cross-match and still tolerant of door-light.
export const MATCH_THRESHOLD = 95;

let client: RekognitionClient | null = null;
let warned = false;

export function faceConfigured(): boolean {
  return Boolean(
    process.env.FACE_AWS_ACCESS_KEY_ID &&
      process.env.FACE_AWS_SECRET_ACCESS_KEY &&
      process.env.FACE_AWS_REGION
  );
}

function rekognition(): RekognitionClient {
  if (!client) {
    if (!faceConfigured() && !warned) {
      warned = true;
      console.error("face.ts: FACE_AWS_* env vars are not set — face punch cannot work");
    }
    client = new RekognitionClient({
      region: process.env.FACE_AWS_REGION ?? "ap-south-1",
      credentials: {
        accessKeyId: process.env.FACE_AWS_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.FACE_AWS_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return client;
}

/** One private collection per tenant — isolation at the provider too. */
function collectionId(tenantId: string): string {
  return `bpm-faces-${tenantId}`;
}

async function ensureCollection(tenantId: string): Promise<void> {
  try {
    await rekognition().send(new CreateCollectionCommand({ CollectionId: collectionId(tenantId) }));
  } catch (e: unknown) {
    if ((e as { name?: string }).name === "ResourceAlreadyExistsException") return;
    throw e;
  }
}

/**
 * Index one enrollment frame. Returns the provider's face id, or null when
 * the frame holds no single usable face (blurred, empty, several people) —
 * the caller treats null as "retake", never as an error.
 */
export async function indexFace(tenantId: string, employeeId: string, jpeg: Buffer): Promise<string | null> {
  await ensureCollection(tenantId);
  const res = await rekognition().send(
    new IndexFacesCommand({
      CollectionId: collectionId(tenantId),
      Image: { Bytes: jpeg },
      ExternalImageId: employeeId,
      MaxFaces: 1,
      QualityFilter: "AUTO",
      DetectionAttributes: [],
    })
  );
  return res.FaceRecords?.[0]?.Face?.FaceId ?? null;
}

export type FaceMatch = { employeeId: string; confidence: number };

/**
 * Who is this? Searches the tenant's collection with one camera frame.
 * Returns the best match at/above MATCH_THRESHOLD, or null — including
 * when the frame has no detectable face at all (Rekognition raises
 * InvalidParameterException for that; the kiosk treats it as "keep
 * looking", not an error).
 */
export async function searchFace(tenantId: string, jpeg: Buffer): Promise<FaceMatch | null> {
  try {
    const res = await rekognition().send(
      new SearchFacesByImageCommand({
        CollectionId: collectionId(tenantId),
        Image: { Bytes: jpeg },
        FaceMatchThreshold: MATCH_THRESHOLD,
        MaxFaces: 1,
      })
    );
    const m = res.FaceMatches?.[0];
    if (!m?.Face?.ExternalImageId || m.Similarity == null) return null;
    return { employeeId: m.Face.ExternalImageId, confidence: m.Similarity };
  } catch (e: unknown) {
    const name = (e as { name?: string }).name;
    // No face in frame / collection not created yet -> "no match", not a 500.
    if (name === "InvalidParameterException" || name === "ResourceNotFoundException") return null;
    throw e;
  }
}

/** Employee deactivated or enrollment revoked -> template gone same call. */
export async function deleteFaces(tenantId: string, faceIds: string[]): Promise<void> {
  if (faceIds.length === 0) return;
  try {
    await rekognition().send(
      new DeleteFacesCommand({ CollectionId: collectionId(tenantId), FaceIds: faceIds })
    );
  } catch (e: unknown) {
    if ((e as { name?: string }).name === "ResourceNotFoundException") return;
    throw e;
  }
}

/** Tenant offboarding: drop the whole collection. */
export async function deleteCollection(tenantId: string): Promise<void> {
  try {
    await rekognition().send(new DeleteCollectionCommand({ CollectionId: collectionId(tenantId) }));
  } catch (e: unknown) {
    if ((e as { name?: string }).name === "ResourceNotFoundException") return;
    throw e;
  }
}

/** sha-256 hex — how kiosk device tokens are stored (never plaintext). */
export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
