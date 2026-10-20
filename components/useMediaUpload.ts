"use client";

import { useAction, useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, TRACK_MAX_BYTES, TRACK_TYPES } from "@/convex/lib/media";

export type MediaPurpose = "photo" | "track" | "groupPhoto";

/**
 * Upload a photo or track: beginUpload, then a signed PUT to R2, then confirm it.
 * The upload URL only accepts this exact file size and type, and expires in 5 minutes.
 * Tracks are confirmed by confirmTrackUpload, which checks the object right away and
 * throws if the server rejected it. Pass tracks through lib/transcode first: only the
 * 128 kbps copy is uploaded. Photos go through the component's syncMetadata, and the
 * server records them a moment later, so watch the profile query for the result.
 * Group photos (purpose "groupPhoto") take the same path as photos and need `groupId`.
 * Resolves with the object key.
 */
export function useMediaUpload() {
  const beginUpload = useMutation(api.media.beginUpload);
  const generateUploadUrl = useMutation(api.media.generateUploadUrl);
  const syncMetadata = useMutation(api.media.syncMetadata);
  const confirmTrackUpload = useAction(api.media.confirmTrackUpload);

  return useCallback(
    async (file: File, opts: { purpose: MediaPurpose; title?: string; groupId?: Id<"groups"> }): Promise<string> => {
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
        groupId: opts.groupId,
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
      if (track) {
        const { accepted } = await confirmTrackUpload({ uploadId });
        if (!accepted) throw new Error("Upload failed: file was rejected");
      } else {
        await syncMetadata({ key });
      }
      return key;
    },
    [beginUpload, generateUploadUrl, syncMetadata, confirmTrackUpload],
  );
}
