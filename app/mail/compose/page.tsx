import { Compose } from "@/components/mail/Compose";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function Page({ searchParams }: PageProps<"/mail/compose">) {
  const sp = await searchParams;
  const to = first(sp.to).trim().slice(0, 20);
  const replyTo = first(sp.replyTo).trim().slice(0, 64);
  // Keyed so a link from one reply to another starts a fresh form.
  return <Compose key={`${to}|${replyTo}`} to={to} replyTo={replyTo || undefined} />;
}
