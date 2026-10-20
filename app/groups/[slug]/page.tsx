import { GroupPage } from "@/components/groups/GroupPage";

export default async function Page({ params }: PageProps<"/groups/[slug]">) {
  const { slug } = await params;
  return <GroupPage slug={slug} />;
}
