# Deploying your own TopEight

You need four free accounts: Convex (database and backend), Cloudflare (R2 file storage), Resend (email) and Vercel (hosting). You also need two domains. Allow about an hour.

## 1. Pick two domains

TopEight serves the trusted site and user-written profile code from two different origins.

- Main origin, for example `https://topeight.app`. Sign-in, edit pages and the trusted profile strip live here.
- Usercontent origin, for example `https://topeight.site`. Only the sandboxed profile documents live here.

> **Warning.** The usercontent domain must be a different registrable domain from the main one. A subdomain such as `profiles.topeight.app` is not enough. Browsers share cookies between subdomains of one registrable domain, and the whole point of the split is that artist JavaScript can never see a session cookie. Buy a second domain.

## 2. Create the Convex project

1. Fork or clone the repo and run `npm install`.
2. Run `npx convex dev` once and create a new project when asked. Stop it when the first push finishes.
3. In the Convex dashboard, create a production deployment, or run `npx convex deploy` to create one.
4. Generate the Convex Auth keys with `npx @convex-dev/auth`, or follow the manual setup in the Convex Auth docs. You need `JWT_PRIVATE_KEY` and `JWKS`.

## 3. Create the R2 buckets

TopEight uses two buckets: a public one for photos and a private one for tracks.

1. In the Cloudflare dashboard, open R2 and create the photo bucket. The name goes in `R2_BUCKET`.
2. Make the photo bucket publicly readable. Either attach a custom domain such as `https://media.example.com` under Settings, Custom Domains, or turn on the `r2.dev` URL. The URL goes in `NEXT_PUBLIC_R2_PUBLIC_URL`. A custom domain is the better choice for production because `r2.dev` is rate limited.
3. Create a second bucket for tracks. The name goes in `R2_AUDIO_BUCKET`. Keep it private: do not attach a custom domain and do not turn on the `r2.dev` URL. Nothing in it may ever be publicly reachable. Tracks play only through signed URLs that expire after 15 minutes, and artists upload a 128 kbps copy that their browser makes, never the original.
4. Under R2, Manage API Tokens, create an API token with Object Read and Write on both buckets. Copy the access key ID and the secret access key. TopEight does not use the token value. Note the S3 endpoint, which looks like `https://<account-id>.r2.cloudflarestorage.com`.
5. Open each bucket, then Settings, then CORS policy, and add the same policy to both:

```json
[
  {
    "AllowedOrigins": ["https://topeight.app"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type", "if-none-match"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace the origin with your main origin. Add `http://localhost:3000` if you want uploads to work from a local copy.

`content-type` is required because the browser sends a `Content-Type` header on every upload, and the upload URL is signed for that exact type. Without it the preflight request fails and every upload is blocked. `if-none-match` is required because the browser sends `If-None-Match: *` so an upload can never overwrite an existing object. That header is signed into the upload URL too, and the browser blocks the request if CORS does not allow it.

## 4. Set up Resend

1. In Resend, add your sending domain and add the DNS records it shows you.
2. Wait for the domain to verify, then create an API key. That is `AUTH_RESEND_KEY`.
3. Choose a from address on that domain, for example `TopEight <noreply@example.com>`. That is `AUTH_EMAIL_FROM`.

Without `AUTH_RESEND_KEY`, verification and reset codes are printed to the Convex logs instead of emailed. That is fine for a private test and wrong for a public site.

## 5. Set the Convex environment variables

Set each one on the production deployment with `npx convex env set NAME value` (add `--prod` if your CLI is pointed at the dev deployment).

These go on Convex:

| Variable | Value |
| --- | --- |
| `JWT_PRIVATE_KEY` | From step 2 |
| `JWKS` | From step 2 |
| `SITE_URL` | Your main origin |
| `ADMIN_EMAILS` | Comma-separated emails of admins |
| `HOUSE_USERNAME` | Username of the account every new member befriends, for example `topeight` |
| `HOUSE_DISPLAY_NAME` | Its display name, for example `TopEight` |
| `AUTH_RESEND_KEY` | From step 4 |
| `AUTH_EMAIL_FROM` | From step 4 |
| `R2_ACCESS_KEY_ID` | From step 3 |
| `R2_SECRET_ACCESS_KEY` | From step 3 |
| `R2_ENDPOINT` | From step 3 |
| `R2_BUCKET` | From step 3, the public photo bucket |
| `R2_AUDIO_BUCKET` | From step 3, the private track bucket |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | The public photo bucket URL, no trailing slash needed |
| `FRAME_PASS_SECRET` | A long random string, for example from `openssl rand -base64 32`. Signs the 2-hour frame passes that let friends see a private profile. Without it, private profiles never render in the frame, even for friends. Changing it ends every pass in use |

Then push the functions with `npx convex deploy`.

## 6. Create the Vercel project

1. Import the repo into Vercel. The framework is detected as Next.js.
2. Add these environment variables for Production:

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_MAIN_ORIGIN` | Your main origin, for example `https://topeight.app` |
| `NEXT_PUBLIC_USERCONTENT_ORIGIN` | Your usercontent origin, for example `https://topeight.site` |
| `NEXT_PUBLIC_CONVEX_URL` | The production Convex URL, ending in `.convex.cloud` |
| `NEXT_PUBLIC_SUPPORT_URL` | Optional. A GitHub Sponsors or Open Collective page for the footer "Support TopEight" link. Set it on Vercel; leave it unset to hide the link |

3. Under Settings, Domains, attach both domains to this same project. Do not make a second project. The app tells the two apart by hostname and serves the profile documents only on the usercontent host.
4. Set the build command to `npx convex deploy --cmd 'npm run build'` if you want Vercel to push Convex functions on each deploy. That needs a `CONVEX_DEPLOY_KEY` env var from the Convex dashboard. Skip it if you run `npx convex deploy` by hand.
5. Deploy. Open the main origin, sign up and check that a profile loads inside its frame.

> **Preview deployments.** The app answers only on the two hosts named in `NEXT_PUBLIC_MAIN_ORIGIN` and `NEXT_PUBLIC_USERCONTENT_ORIGIN` and returns 404 on every other host. Vercel's generated preview URLs (`*.vercel.app`) match neither, so previews 404 out of the box. To use previews, give a preview branch its own pair of domains (two different registrable domains, as in step 1), and set the three variables above for Preview with that pair and a non-production Convex URL. Otherwise treat previews as unsupported.

## 7. Admins and the house account

- Anyone whose verified email is in `ADMIN_EMAILS` can use `/admin` to review reports and ban accounts.
- The house account is created the first time someone signs up, from `HOUSE_USERNAME` and `HOUSE_DISPLAY_NAME`. Every member starts with it as a friend and as their first Top 8 entry. Pick a username nobody else wants, because a member who already holds that username blocks signup until you change it.

## 8. Never set these in production

- `TOPEIGHT_TEST_FIXTURES` turns on end-to-end test fixtures that create accounts without email checks. Never set it on a public deployment.
- Never set `TOPEIGHT_ALLOW_SEED` in production. It allows the demo seed to run.

## 9. Seed demo content (optional)

The seed creates 8 fans, 5 artists, tracks, shows, comments and bulletins so a fresh copy looks alive. The accounts have no email, so nobody can sign in as them. Use it only on a local or staging deployment. Never seed production.

1. Upload the seed media. Set the `R2_*` variables in your shell, then run `node scripts/seed-media.mjs`. This uploads three silent MP3s to the audio bucket and a small avatar for each seed user to the photo bucket. Run it with `--dry-run` to only generate files.
2. `npx convex env set TOPEIGHT_ALLOW_SEED 1`
3. `npx convex run seed:run`
4. `npx convex env remove TOPEIGHT_ALLOW_SEED`

Running the seed again is safe. It updates the demo profiles and refreshes the show dates.

## 10. After upgrading

Before you deploy this version, check for profiles named `mail`, `favorites`, `blog`, `events`, `groups` or `brand`. Those pages are now site routes, so they shadow a profile with the same name and its page can no longer be reached. New sign-ups can't take these names, but older profiles may already have them. Look each one up in the Convex dashboard's `profiles` table, filtering on `username`, and rename any you find before deploying.

Follow these steps in order on an existing deployment.

1. Create the private audio bucket. Give it no public domain and leave the r2.dev URL off.
2. Add its CORS policy, the same one as in section 3.
3. Give the API token Object Read & Write on both buckets.
4. Set `R2_AUDIO_BUCKET` on Convex: `npx convex env set R2_AUDIO_BUCKET <bucket name>`.
5. Deploy.
6. Run `npx convex run migrations:moveTracksToAudioBucket`.
7. Run `npx convex run migrations:backfillMediaFlags`.
8. Run `npx convex run migrations:backfillSongPicks`.
9. Smoke test: upload a song, play it, delete it.

Deletes fail until `R2_AUDIO_BUCKET` is set, so do not deploy before step 4.

Step 6 copies songs uploaded before the audio bucket existed out of the public photo bucket, where anyone with the link can reach them and where they no longer play. It copies each one to `R2_AUDIO_BUCKET` unless it is already there, then deletes the public copy. It works through 50 songs at a time and schedules itself until done, logging moved, skipped and failed counts per page and at the end. Running it again is safe, and songs that already moved are skipped. If the token lacks access to either bucket, the run stops with an error that names the bucket. Fix the token and run it again.

Step 7 sets the photo and track flags that Cool New People and Cool New Music read, on profiles made before those flags existed. It works through 100 profiles at a time and schedules itself until done. Running it again is safe.

Step 8 builds the song pick records that the "Your songs are on N profiles" count reads, from profile songs set before they existed. It works through 20 profiles at a time and schedules itself until done. Running it again is safe.

You can rerun the backfill migrations, steps 6, 7 and 8, at any time. Each skips work that is already done, so a rerun after a failed or partial run is safe.
