import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTP, ResendOTPPasswordReset } from "./lib/otp";
import { hashPassword, verifyPassword } from "./lib/password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        if (!email) throw new Error("Email is required");
        return { email };
      },
      crypto: {
        hashSecret: hashPassword,
        verifySecret: verifyPassword,
      },
      verify: ResendOTP,
      reset: ResendOTPPasswordReset,
    }),
  ],
});
