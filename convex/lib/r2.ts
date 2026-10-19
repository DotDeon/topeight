import { R2 } from "@convex-dev/r2";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";

/** The R2 component client. Reads R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY. */
export const r2 = new R2(components.r2);

type ReadCtx = Pick<GenericQueryCtx<DataModel>, "runQuery">;
type WriteCtx = Pick<GenericMutationCtx<DataModel>, "runQuery" | "runMutation">;

/**
 * Every R2 call the app makes, in one object so tests can stub it.
 * Call these as `storage.x(...)`, never destructured, or stubs will not apply.
 */
export const storage = {
  /** A signed PUT URL for a server-chosen key. */
  async uploadUrl(key: string): Promise<{ key: string; url: string }> {
    return await r2.generateUploadUrl(key);
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
