import { Email } from "@convex-dev/auth/providers/Email";

const CODE_LENGTH = 8;
const CODE_MAX_AGE_SECONDS = 15 * 60;

function randomDigits(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // 256 is not a multiple of 10, so reject bytes >= 250 to avoid bias.
  let out = "";
  for (let i = 0; out.length < length; i++) {
    if (i >= bytes.length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
    if (bytes[i] < 250) out += String(bytes[i] % 10);
  }
  return out;
}

async function sendCode(email: string, subject: string, code: string) {
  const apiKey = process.env.AUTH_RESEND_KEY;
  if (!apiKey) {
    // Local development without email: read the code from the Convex logs.
    console.log(`[TopEight] ${subject} for ${email}: ${code}`);
    return;
  }
  const from = process.env.AUTH_EMAIL_FROM;
  if (!from) throw new Error("AUTH_EMAIL_FROM must be set when AUTH_RESEND_KEY is set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      text: `Your TopEight code is ${code}\n\nIt expires in 15 minutes. If you did not ask for this, ignore this email.`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Could not send email (${res.status}): ${await res.text()}`);
  }
}

function otpProvider(id: string, subject: string) {
  return Email({
    id,
    maxAge: CODE_MAX_AGE_SECONDS,
    async generateVerificationToken() {
      return randomDigits(CODE_LENGTH);
    },
    async sendVerificationRequest({ identifier, token }) {
      await sendCode(identifier, subject, token);
    },
  });
}

export const ResendOTP = otpProvider("resend-otp", "Verify your TopEight email");
export const ResendOTPPasswordReset = otpProvider(
  "resend-otp-password-reset",
  "Reset your TopEight password",
);
