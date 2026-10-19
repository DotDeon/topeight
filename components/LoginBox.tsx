"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { normalizeEmail } from "@/components/AuthBox";
import { Box } from "@/components/Box";
import styles from "./LoginBox.module.css";

/** The orange Member Login box on the logged-out homepage. */
export function LoginBox() {
  const { signIn } = useAuthActions();
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const email = normalizeEmail(form.get("email"));
      const result = await signIn("password", {
        email,
        password: String(form.get("password")),
        flow: "signIn",
      });
      // An unverified account gets a fresh code instead of a session.
      if (!result.signingIn) setPendingEmail(email);
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
        email: pendingEmail!,
        code: String(form.get("code")).trim(),
        flow: "email-verification",
      });
    } catch {
      setError("That code is wrong or has expired.");
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? <p className={styles.error}>{error}</p> : null;

  if (pendingEmail) {
    return (
      <Box title="Member Login">
        <form className={styles.login} onSubmit={submitCode}>
          {errorLine}
          <p className={styles.note}>Your e-mail is not verified yet. We sent a code to {pendingEmail}.</p>
          <label htmlFor="home-code">Code:</label>
          <input id="home-code" name="code" type="text" required inputMode="numeric" autoComplete="one-time-code" />
          <div className={styles.actions}>
            <button className={styles.btn} type="submit" disabled={busy}>VERIFY</button>
          </div>
        </form>
      </Box>
    );
  }

  return (
    <Box title="Member Login">
      <form className={styles.login} onSubmit={submitLogin}>
        {errorLine}
        <label htmlFor="home-email">E-Mail:</label>
        <input id="home-email" name="email" type="email" required autoComplete="email" />
        <label htmlFor="home-password">Password:</label>
        <input id="home-password" name="password" type="password" required autoComplete="current-password" />
        <div className={styles.remember}>
          <input id="home-remember" name="remember" type="checkbox" />{" "}
          <label htmlFor="home-remember">Remember Me</label>
        </div>
        <div className={styles.actions}>
          <button className={styles.btn} type="submit" disabled={busy}>LOGIN</button>{" "}
          <Link href="/reset">Forgot your password?</Link>
        </div>
      </form>
      <Link className={styles.signup} href="/signup">SIGN UP!</Link>
    </Box>
  );
}
