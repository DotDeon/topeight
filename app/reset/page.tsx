"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthBox, authStyles as s, normalizeEmail } from "@/components/AuthBox";

export default function ResetPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A successful reset signs the user in.
  useEffect(() => {
    if (isAuthenticated) router.replace("/");
  }, [isAuthenticated, router]);

  async function submitEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await signIn("password", { email: normalizeEmail(form.get("email")), flow: "reset" });
      setEmail(normalizeEmail(form.get("email")));
    } catch {
      setError("Could not send a reset code to that e-mail.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await signIn("password", {
        email: email!,
        code: String(form.get("code")).trim(),
        newPassword: String(form.get("newPassword")),
        flow: "reset-verification",
      });
    } catch {
      setError("That code is wrong or has expired, or the password is shorter than 8 characters.");
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? <p className={s.error}>{error}</p> : null;

  if (email) {
    return (
      <AuthBox title="Reset Password">
        {errorLine}
        <p className={s.note}>We sent a code to {email}.</p>
        <form onSubmit={submitReset}>
          <div className={s.row}>
            <label htmlFor="code">Code</label>
            <input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code" />
          </div>
          <div className={s.row}>
            <label htmlFor="newPassword">New Password</label>
            <input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          <div className={s.actions}>
            <button type="submit" disabled={busy}>Reset Password</button>
          </div>
        </form>
      </AuthBox>
    );
  }

  return (
    <AuthBox title="Reset Password">
      {errorLine}
      <form onSubmit={submitEmail}>
        <div className={s.row}>
          <label htmlFor="email">E-Mail</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className={s.actions}>
          <button type="submit" disabled={busy}>Send Code</button>
        </div>
      </form>
      <div className={s.links}>
        <Link href="/login">Back to login</Link>
      </div>
    </AuthBox>
  );
}
