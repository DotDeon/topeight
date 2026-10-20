import { GroupSettings } from "@/components/groups/GroupSettings";

export default async function Page({ params }: PageProps<"/groups/[slug]/settings">) {
  const { slug } = await params;
  return <GroupSettings slug={slug} />;
}
