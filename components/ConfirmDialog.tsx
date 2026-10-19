"use client";

import { useEffect, useRef, useState } from "react";
import type { BridgeAction } from "@/lib/bridge-protocol";
import { PROFILE_ACTIONS, type ActionTarget } from "./profileActions";
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
}: {
  request: ConfirmRequest | null;
  target: ActionTarget;
  onClose: (outcome: "cancelled" | "done") => void;
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
  onDismiss,
}: {
  action: BridgeAction;
  target: ActionTarget;
  onRan: (action: BridgeAction) => void;
  onDismiss: () => void;
}) {
  const spec = PROFILE_ACTIONS[action];
  const [phase, setPhase] = useState<"ask" | "running" | "done">("ask");
  const [result, setResult] = useState("");
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  async function confirm() {
    if (!spec.run || phase !== "ask") return;
    setPhase("running");
    try {
      setResult(await spec.run(target));
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Something went wrong.");
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
                disabled={!armed || phase === "running"}
                onClick={confirm}
              >
                Confirm
              </button>
              <button type="button" className={styles.btn} onClick={onDismiss} autoFocus>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={styles.btn} onClick={onDismiss} autoFocus>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
