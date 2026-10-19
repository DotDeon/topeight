import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2 } from "@convex-dev/r2";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

/** The R2 component client. Reads R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY. */
export const r2 = new R2(components.r2);

/** Signed upload URLs stop working after this many seconds. */
export const UPLOAD_URL_TTL_S = 300;

type ReadCtx = Pick<GenericQueryCtx<DataModel>, "runQuery">;
type WriteCtx = Pick<GenericMutationCtx<DataModel>, "runQuery" | "runMutation">;

export type PutTarget = { key: string; size: number; contentType: string };

/**
 * A signed PUT URL that only accepts exactly `size` bytes of `contentType`, and only
 * if nothing exists at `key` yet, so a finished or rejected upload cannot be overwritten
 * with something else. Signing is local and needs no network.
 */
export async function presignPut(client: R2, target: PutTarget): Promise<{ key: string; url: string }> {
  const command = new PutObjectCommand({
    Bucket: client.config.bucket,
    Key: target.key,
    ContentLength: target.size,
    ContentType: target.contentType,
    IfNoneMatch: "*",
  });
  const url = await getSignedUrl(client.client, command, {
    expiresIn: UPLOAD_URL_TTL_S,
    signableHeaders: new Set(["content-type"]),
  });
  return { key: target.key, url };
}

/**
 * Every R2 call the app makes, in one object so tests can stub it.
 * Call these as `storage.x(...)`, never destructured, or stubs will not apply.
 */
export const storage = {
  /** A signed PUT URL for a server-chosen key, locked to the declared size and type. */
  async uploadUrl(target: PutTarget): Promise<{ key: string; url: string }> {
    return await presignPut(r2, target);
  },
  /** Size and content type as synced from R2, or null if the object has not been synced. */
  async metadata(
    ctx: ReadCtx,
    key: string,
  ): Promise<{ key: string; size?: number; contentType?: string } | null> {
    return await r2.getMetadata(ctx, key);
  },
  /** Delete an object and its synced metadata. The R2 delete runs in the background. */
  async remove(ctx: WriteCtx, key: string): Promise<void> {
    await r2.deleteObject(ctx, key);
  },
};
