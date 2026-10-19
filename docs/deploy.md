# Deploying OpenSpace

## R2 bucket CORS

Browsers upload photos and tracks straight to R2 with a signed PUT URL, so the
bucket's CORS policy must allow PUT from your main site origin
(`NEXT_PUBLIC_MAIN_ORIGIN`). Profiles play tracks and show photos from
`NEXT_PUBLIC_R2_PUBLIC_URL`, which also needs GET. In the Cloudflare dashboard,
open the bucket, then Settings, then CORS policy, and add:

```json
[
  {
    "AllowedOrigins": ["https://openspace.example.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"]
  }
]
```

Replace the origin with your `NEXT_PUBLIC_MAIN_ORIGIN`. For local development
add `http://localhost:3000` as well.

The Convex deployment needs `R2_TOKEN`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET` and
`NEXT_PUBLIC_R2_PUBLIC_URL`. Set each with `npx convex env set NAME value`.
