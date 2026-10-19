"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthBox, authStyles as s, normalizeEmail } from "@/components/AuthBox";
import { api } from "@/convex/_generated/api";

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");

  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Signed in: go home, or finish the profile step if it was skipped.
  useEffect(() => {
    if (me === null) router.replace("/signup");
    else if (me) router.replace("/");
  }, [me, router]);

  async function submitLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await signIn("password", {
        email: normalizeEmail(form.get("email")),
        password: String(form.get("password")),
        flow: "signIn",
      });
      // An unverified account gets a fresh code instead of a session.
      if (!result.signingIn) setEmail(normalizeEmail(form.get("email")));
    } catch {
      setError("Invalid e-mail or password.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await signIn("password", {
        email: email!,
        code: String(form.get("code")).trim(),
        flow: "email-verification",
      });
    } catch {
      setError("That code is wrong or has expired.");
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? <p className={s.error}>{error}</p> : null;

  if (isLoading || isAuthenticated) {
    return <AuthBox title="Member Login">Loading...</AuthBox>;
  }

  if (email) {
    return (
      <AuthBox title="Member Login: Verify Email">
        {errorLine}
        <p className={s.note}>Your e-mail is not verified yet. We sent a code to {email}.</p>
        <form onSubmit={submitCode}>
          <div className={s.row}>
            <label htmlFor="code">Code</label>
            <input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code" />
          </div>
          <div className={s.actions}>
            <button type="submit" disabled={busy}>Verify</button>
          </div>
        </form>
      </AuthBox>
    );
  }

  return (
    <AuthBox title="Member Login">
      {errorLine}
      <form onSubmit={submitLogin}>
        <div className={s.row}>
          <label htmlFor="email">E-Mail</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className={s.row}>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <div className={s.actions}>
          <button type="submit" disabled={busy}>Login</button>
        </div>
      </form>
      <div className={s.links}>
        <Link href="/reset">Forgot your password?</Link>
        <br />
        Not a member? <Link href="/signup">Sign up</Link>
      </div>
    </AuthBox>
  );
}
