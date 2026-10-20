"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import styles from "./Posts.module.css";

const MAX_REASON = 500;

/** A small Report button for one comment, bulletin, message, blog post, blog comment, event, group, group topic or group post. Asks for a reason with window.prompt. */
type ReportTarget = "comment" | "bulletin" | "message" | "blogPost" | "blogComment" | "event" | "group" | "groupTopic" | "groupReply";
const TARGET_NAME: Record<ReportTarget, string> = {
  comment: "comment",
  bulletin: "bulletin",
  message: "message",
  blogPost: "blog post",
  blogComment: "blog comment",
  event: "event",
  group: "group",
  groupTopic: "topic",
  groupReply: "post",
};

export function ReportLink({ targetType, targetId }: { targetType: ReportTarget; targetId: string }) {
  const { isAuthenticated } = useConvexAuth();
  const report = useMutation(api.moderation.report);
  const [note, setNote] = useState("");
  if (!isAuthenticated) {
    return (
      <Link href="/login" className={styles.del}>
        Log in to report
      </Link>
    );
  }
  async function ask() {
    const reason = window.prompt(`Why are you reporting this ${TARGET_NAME[targetType]}? (up to ${MAX_REASON} characters)`);
    if (reason === null) return;
    if (reason.trim() === "") {
      setNote("Give a reason");
      return;
    }
    try {
      await report({ targetType, targetId, reason: reason.slice(0, MAX_REASON) });
      setNote("Reported");
    } catch (e) {
      setNote(e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong.");
    }
  }
  return (
    <>
      <button type="button" className={styles.del} onClick={() => void ask()}>
        Report
      </button>
      {note && (
        <span className={styles.del} role="status">
          {note}
        </span>
      )}
    </>
  );
}
