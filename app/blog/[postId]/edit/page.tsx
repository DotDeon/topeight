import { EditPost } from "@/components/blog/WritePages";

export default async function Page({ params }: PageProps<"/blog/[postId]/edit">) {
  const { postId } = await params;
  return <EditPost id={postId} />;
}
