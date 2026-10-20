# TopEight payments design

Date: 2026-10-20
Status: agreed with the owner, on hold. Paid features show "coming soon" until the owner switches payments on.

## Intent

Keep TopEight from running at a loss without charging fans. Artists pay for features that help their music get heard. Running costs at launch are roughly $45 to $70 a month (Vercel Pro, Convex after the free tier, R2 past 10 GB, Resend past 3,000 emails a month), so about 15 Artist Pro members cover the bill.

## Decisions made by the owner

- Three revenue sources: Artist Pro, paid homepage spots, and donations.
- Payment provider: Paystack. Stripe does not offer standard accounts to South African businesses, and the owner takes payments as a South African business.
- Prices are shown in US dollars to everyone. Paystack charges South African merchants in rand only, so checkout bills the rand equivalent, with the line "Billed as R<amount> in South African rand. Your bank converts it." The rand amounts are reviewed every 3 months.
- The Artist Pro plan below was approved as written.
- Until launch of payments, every paid feature shows "coming soon".

## Artist Pro

- $5 a month, billed as about R89.
- Artist accounts only. Fans see no upsell.
- Includes:
  - 50 songs instead of 10.
  - Songs up to 15 MB, streamed at 192 kbps instead of 128.
  - Play counts per song, visible only to the artist on Edit Profile.
  - A "Pro" star beside the artist's name, separate from verification.
  - Priority in Cool New Music: Pro artists first, then everyone else.
- Verification is free and separate. An artist requests it from Edit Profile; an admin approves it on `/admin`; the profile shows a "Verified" tick.
- Paying: "Go Pro" sends the artist to Paystack checkout (a Paystack plan subscription). They cancel any time from Edit Profile.
- When Pro lapses, nothing is deleted. Songs past the first 10 are hidden until the artist renews or removes some. Play counts stop showing.
- `/admin` lists Pro members and their renewal dates.

## Homepage spots (draft, not yet confirmed by the owner)

These points were proposed and are waiting for the owner's review before payments are built:

- $10 a week, billed as about R199.
- Two spot types: the homepage banner (one artist per week) and a featured show pinned in Upcoming Shows (up to 3 per week).
- Artists book from Edit Profile, picking a start week up to 8 weeks ahead, and pay through Paystack.
- The banner takes a 728 by 90 image and a link to the artist's profile or show.
- Every paid spot waits for admin approval. A rejected spot is refunded in full through Paystack.
- Spots drop off automatically at the end of the week.
- With nothing booked, the banner shows the house message.

## Donations

- A "Support TopEight" footer link to the owner's GitHub Sponsors or Open Collective page, set with `NEXT_PUBLIC_SUPPORT_URL`. Hidden when unset. No payment code. This is live now.

## Open items before building payments

- The owner confirms the homepage spots draft.
- The owner opens and verifies a Paystack business account (1 to 3 days) and supplies keys through a private secret request.
- Webhook handling for subscription renewals, failures and cancellations, and how long a failed renewal keeps Pro (builder's call, suggest 3 days).
- VAT: whether prices include VAT once the business is VAT registered.
