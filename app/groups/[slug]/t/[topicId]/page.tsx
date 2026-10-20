import { TopicPage } from "@/components/groups/TopicPage";

export default async function Page({ params }: PageProps<"/groups/[slug]/t/[topicId]">) {
  const { topicId } = await params;
  return <TopicPage topicId={topicId} />;
}
