import { StopInvites } from "@/components/invite/StopInvites";

export default async function Page({ searchParams }: PageProps<"/invite/stop">) {
  const { t } = await searchParams;
  const token = (typeof t === "string" ? t : "").trim().slice(0, 64);
  return <StopInvites token={token} />;
}
