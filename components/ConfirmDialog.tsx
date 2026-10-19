"use client";

import { useConvex } from "convex/react";
import { useEffect, useRef, useState } from "react";
import type { BridgeAction } from "@/lib/bridge-protocol";
import { PROFILE_ACTIONS, type ActionResult, type ActionTarget } from "./profileActions";
import styles from "./ConfirmDialog.module.css";

/** Confirm stays disabled this long after opening, so a click already on its way lands nowhere. */
export const ARM_DELAY_MS = 500;

export type ConfirmRequest = { id: number; action: BridgeAction };

/**
 * The parent page's own confirmation step. It is a modal <dialog> in the top
 * layer of the main-origin page, so the sandboxed iframe cannot draw over it
 * or click it. Nothing runs until the visitor clicks Confirm here.
 *
 * Test hook: data-last-action on the root names the last action that ran.
 */
export function ConfirmDialog({
  request,
  target,
  onClose,
  onResult,
}: {
  request: ConfirmRequest | null;
  target: ActionTarget;
  onClose: (outcome: "cancelled" | "done") => void;
  /** Called with the text the dialog shows after an action ran. */
  onResult?: (action: BridgeAction, result: ActionResult) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [lastAction, setLastAction] = useState<BridgeAction | null>(null);
  const outcome = useRef<"cancelled" | "done">("cancelled");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) {
      outcome.current = "cancelled";
      dialog.showModal();
      // Start on Cancel (or Close), so Enter or Space never confirms by default.
      dialog.querySelector<HTMLButtonElement>("[data-dialog-dismiss]")?.focus();
    }
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      data-openspace-confirm=""
      data-last-action={lastAction ?? undefined}
      aria-labelledby="openspace-confirm-title"
      onClose={() => onClose(outcome.current)}
    >
      {request && (
        <DialogBody
          key={request.id}
          action={request.action}
          target={target}
          onResult={onResult}
          onRan={(a) => {
            outcome.current = "done";
            setLastAction(a);
          }}
          onDismiss={() => ref.current?.close()}
        />
      )}
    </dialog>
  );
}

function DialogBody({
  action,
  target,
  onRan,
  onResult,
  onDismiss,
}: {
  action: BridgeAction;
  target: ActionTarget;
  onResult?: (action: BridgeAction, result: ActionResult) => void;
  onRan: (action: BridgeAction) => void;
  onDismiss: () => void;
}) {
  const spec = PROFILE_ACTIONS[action];
  const client = useConvex();
  const [phase, setPhase] = useState<"ask" | "running" | "done">("ask");
  const [result, setResult] = useState("");
  const [armed, setArmed] = useState(false);
  const [text, setText] = useState("");
  const textOk = !spec.input || text.trim() !== "";

  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  async function confirm() {
    if (!spec.run || phase !== "ask" || !textOk) return;
    setPhase("running");
    let outcome: ActionResult;
    try {
      outcome = await spec.run(target, client, text.trim());
    } catch (e) {
      outcome = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." };
    }
    setResult(outcome.text);
    onResult?.(action, outcome);
    // A failed text action keeps what was typed so the visitor can fix it and try again.
    if (!outcome.ok && spec.input) {
      setPhase("ask");
      return;
    }
    setPhase("done");
    onRan(action);
  }

  return (
    <div className={styles.body}>
      <h4 id="openspace-confirm-title" className={styles.title}>
        {spec.label}
      </h4>
      <div className={styles.inner}>
        <p className={styles.question}>{spec.question(target.displayName)}</p>
        {spec.input && phase !== "done" && (
          <label className={styles.field}>
            {spec.input.label}
            <textarea
              className={styles.textarea}
              value={text}
              rows={5}
              maxLength={spec.input.maxLength}
              disabled={phase === "running"}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        {phase === "ask" && result !== "" && (
          <p className={styles.result} role="alert">
            {result}
          </p>
        )}
        {phase === "done" && (
          <p className={styles.result} role="status">
            {result}
          </p>
        )}
        <div className={styles.buttons}>
          {spec.run && phase !== "done" ? (
            <>
              <button
                type="button"
                className={styles.btn}
                disabled={!armed || phase === "running" || !textOk}
                onClick={confirm}
              >
                Confirm
              </button>
              <button type="button" className={styles.btn} onClick={onDismiss} data-dialog-dismiss="">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={styles.btn} onClick={onDismiss} data-dialog-dismiss="">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
