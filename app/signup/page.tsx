"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "@/lib/errorText";
import { AuthBox, authStyles as s, normalizeEmail } from "@/components/AuthBox";
import { api } from "@/convex/_generated/api";

type Step = "account" | "verify";

const KINDS = ["fan", "artist", "venue", "label"] as const;

/** The picked "I am a" radio, fan when it is missing or unknown. */
function signupKind(value: FormDataEntryValue | null): (typeof KINDS)[number] {
  return KINDS.find((k) => k === value) ?? "fan";
}

export default function SignupPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  const createMyProfile = useMutation(api.profiles.createMyProfile);

  const [step, setStep] = useState<Step>("account");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace("/");
  }, [me, router]);

  async function submitAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await signIn("password", {
        email: normalizeEmail(form.get("email")),
        password: String(form.get("password")),
        flow: "signUp",
      });
      setEmail(normalizeEmail(form.get("email")));
      if (!result.signingIn) setStep("verify");
    } catch {
      setError(
        "Could not create the account. The email may already be registered, or the password is shorter than 8 characters.",
      );
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
        email,
        code: String(form.get("code")).trim(),
        flow: "email-verification",
      });
    } catch {
      setError("That code is wrong or has expired.");
    } finally {
      setBusy(false);
    }
  }

  async function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await createMyProfile({
        username: String(form.get("username")),
        displayName: String(form.get("displayName")),
        kind: signupKind(form.get("kind")),
        birthDate: String(form.get("birthDate")),
      });
      router.replace("/");
    } catch (err) {
      setError(errorText(err, "Could not create your profile."));
    } finally {
      setBusy(false);
    }
  }

  const errorLine = error ? <p className={s.error}>{error}</p> : null;

  if (isLoading || (isAuthenticated && me === undefined) || me) {
    return <AuthBox title="Sign Up">Loading...</AuthBox>;
  }

  if (isAuthenticated) {
    return (
      <AuthBox title="Sign Up: Your Profile">
        {errorLine}
        <form onSubmit={submitProfile}>
          <div className={s.row}>
            <label htmlFor="username">Username</label>
            <input id="username" name="username" required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" autoComplete="username" />
          </div>
          <div className={s.row}>
            <label htmlFor="displayName">Display Name</label>
            <input id="displayName" name="displayName" required maxLength={50} />
          </div>
          <div className={s.row}>
            <label>I am a</label>
            <div className={s.radios}>
              <label><input type="radio" name="kind" value="fan" defaultChecked /> Fan</label>
              <label><input type="radio" name="kind" value="artist" /> Artist</label>
              <label><input type="radio" name="kind" value="venue" /> Venue</label>
              <label><input type="radio" name="kind" value="label" /> Label</label>
            </div>
          </div>
          <div className={s.row}>
            <label htmlFor="birthDate">Date of Birth</label>
            <input id="birthDate" name="birthDate" type="date" required />
          </div>
          <p className={s.note}>You must be 13 or older to join.</p>
          <div className={s.actions}>
            <button type="submit" disabled={busy}>Sign Up</button>
          </div>
        </form>
      </AuthBox>
    );
  }

  if (step === "verify") {
    return (
      <AuthBox title="Sign Up: Verify Email">
        {errorLine}
        <p className={s.note}>We sent a code to {email}. Enter it below.</p>
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
    <AuthBox title="Sign Up">
      {errorLine}
      <form onSubmit={submitAccount}>
        <div className={s.row}>
          <label htmlFor="email">E-Mail</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className={s.row}>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </div>
        <div className={s.actions}>
          <button type="submit" disabled={busy}>Next</button>
        </div>
      </form>
      <div className={s.links}>
        Already a member? <Link href="/login">Log in</Link>
      </div>
    </AuthBox>
  );
}
