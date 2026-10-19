import { tokenizeComment } from "@/lib/validation";

/**
 * A comment or bulletin body as React nodes. Text stays text, image URLs
 * become <img>, other URLs become links. Nothing is parsed as HTML.
 */
export function PostBody({ body }: { body: string }) {
  return (
    <>
      {tokenizeComment(body).map((t, i) => {
        if (t.type === "text") return <span key={i}>{t.value}</span>;
        if (t.type === "image") {
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external image URLs
          return <img key={i} src={t.url} alt="" referrerPolicy="no-referrer" loading="lazy" style={{ maxWidth: 400 }} />;
        }
        return (
          <a key={i} href={t.url} target="_blank" rel="noopener noreferrer nofollow ugc">
            {t.url}
          </a>
        );
      })}
    </>
  );
}
