import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2 } from "@convex-dev/r2";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

/** The R2 component client for the public photo bucket. Reads R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY. */
export const r2 = new R2(components.r2);

/** Signed upload URLs stop working after this many seconds. */
export const UPLOAD_URL_TTL_S = 300;
/** Signed playback URLs stop working after this many seconds. */
export const PLAYBACK_URL_TTL_S = 900;

type ReadCtx = Pick<GenericQueryCtx<DataModel>, "runQuery">;
type WriteCtx = Pick<GenericMutationCtx<DataModel>, "runQuery" | "runMutation">;

export type MediaPurpose = "photo" | "track";
export type PutTarget = { key: string; size: number; contentType: string; purpose: MediaPurpose };

/**
 * The private bucket tracks live in. Throws when unset, so a track never lands in
 * the public photo bucket by accident.
 */
export function audioBucket(): string {
  const bucket = process.env.R2_AUDIO_BUCKET;
  if (!bucket) throw new Error("R2_AUDIO_BUCKET must be set");
  return bucket;
}

/** True when tracks can be signed: the audio bucket and the R2 credentials are set. */
export function audioConfigured(): boolean {
  return ["R2_AUDIO_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every((k) => !!process.env[k]);
}

function bucketFor(purpose: MediaPurpose): string {
  if (purpose === "track") return audioBucket();
  const bucket = r2.config.bucket;
  if (!bucket) throw new Error("R2_BUCKET must be set");
  return bucket;
}

let s3: S3Client | undefined;
/** One S3 client for both buckets: they share the R2 credentials. */
function client(): S3Client {
  const { R2_ENDPOINT: endpoint, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set");
  }
  s3 ??= new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // Without this the SDK signs a checksum of an empty body, and R2 rejects the real upload.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  return s3;
}

/**
 * A signed PUT URL that only accepts exactly `size` bytes of `contentType`, and only
 * if nothing exists at `key` yet, so a finished or rejected upload cannot be overwritten
 * with something else. Tracks go to the private audio bucket, photos to the public one.
 * Signing is local and needs no network.
 */
export async function presignPut(target: PutTarget): Promise<{ key: string; url: string }> {
  const command = new PutObjectCommand({
    Bucket: bucketFor(target.purpose),
    Key: target.key,
    ContentLength: target.size,
    ContentType: target.contentType,
    IfNoneMatch: "*",
  });
  const url = await getSignedUrl(client(), command, {
    expiresIn: UPLOAD_URL_TTL_S,
    signableHeaders: new Set(["content-type"]),
  });
  return { key: target.key, url };
}

/** A signed GET URL for `key` in `bucket`, valid for `expiresIn` seconds. Local, no network. */
export async function presignGet(key: string, bucket: string, expiresIn: number): Promise<string> {
  return await getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

/** Size and content type from a HEAD request, or null when the object does not exist. */
export async function headObject(key: string, bucket: string): Promise<{ size: number; contentType: string } | null> {
  try {
    const res = await client().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? "" };
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as { name?: string }).name === "NotFound") return null;
    throw e;
  }
}

/**
 * Every R2 call the app makes, in one object so tests can stub it.
 * Call these as `storage.x(...)`, never destructured, or stubs will not apply.
 */
export const storage = {
  /** A signed PUT URL for a server-chosen key, locked to the declared size and type. */
  async uploadUrl(target: PutTarget): Promise<{ key: string; url: string }> {
    return await presignPut(target);
  },
  /** Photos only: size and content type as synced from R2, or null if the object has not been synced. */
  async metadata(
    ctx: ReadCtx,
    key: string,
  ): Promise<{ key: string; size?: number; contentType?: string } | null> {
    return await r2.getMetadata(ctx, key);
  },
  /** HEAD an object directly. Used to confirm track uploads, which skip the component's sync. */
  async head(key: string, bucket: string): Promise<{ size: number; contentType: string } | null> {
    return await headObject(key, bucket);
  },
  /** A 15 minute playback URL for a track in the audio bucket. */
  async playbackUrl(key: string): Promise<string> {
    return await presignGet(key, audioBucket(), PLAYBACK_URL_TTL_S);
  },
  /** Delete an object (and any synced metadata) from its purpose's bucket. The R2 delete runs in the background. */
  async remove(ctx: WriteCtx, key: string, purpose: MediaPurpose): Promise<void> {
    const client = purpose === "track" ? new R2(components.r2, { bucket: audioBucket() }) : r2;
    await client.deleteObject(ctx, key);
  },
};
