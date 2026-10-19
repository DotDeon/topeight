"use client";

import { useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, TRACK_MAX_BYTES, TRACK_TYPES } from "@/convex/lib/media";

export type MediaPurpose = "photo" | "track";

/**
 * Upload a photo or track: beginUpload, then a signed PUT to R2, then syncMetadata.
 * The upload URL only accepts this exact file size and type, and expires in 5 minutes.
 * Resolves with the object key once the file is in R2. The server checks size and
 * type after the sync and records the track or photo a moment later, so watch the
 * profile or track list queries for the result.
 */
export function useMediaUpload() {
  const beginUpload = useMutation(api.media.beginUpload);
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const syncMetadata = useMutation(api.media.syncMetadata);

  return useCallback(
    async (file: File, opts: { purpose: MediaPurpose; title?: string }): Promise<string> => {
      const track = opts.purpose === "track";
      const maxBytes = track ? TRACK_MAX_BYTES : PHOTO_MAX_BYTES;
      const types = track ? TRACK_TYPES : PHOTO_TYPES;
      if (file.size > maxBytes) throw new Error(track ? "Tracks can be at most 5 MB" : "Photos can be at most 2 MB");
      if (!types.includes(file.type)) {
        throw new Error(track ? "Tracks must be MP3 files" : "Photos must be JPEG, PNG, GIF or WebP");
      }

      const { uploadId } = await beginUpload({
        purpose: opts.purpose,
        title: opts.title,
        size: file.size,
        contentType: file.type,
      });
      const { url, key } = await generateUploadUrl({ uploadId });
      // Both headers are signed into the URL. The browser sets Content-Length itself.
      const res = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type, "If-None-Match": "*" },
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      await syncMetadata({ key });
      return key;
    },
    [beginUpload, generateUploadUrl, syncMetadata],
  );
}
