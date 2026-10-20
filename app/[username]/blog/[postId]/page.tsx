import { fetchQuery } from "convex/nextjs";
import { notFound } from "next/navigation";
import { PostPage } from "@/components/blog/PostPage";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";

export default async function Page({ params }: PageProps<"/[username]/blog/[postId]">) {
  const { username, postId } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  const [profile, post] = await Promise.all([
    fetchQuery(api.profiles.profileHeader, { username }),
    fetchQuery(api.blog.get, { id: postId }),
  ]);
  if (profile === null || profile.banned || post === null || post.author.username !== username) notFound();

  return <PostPage id={postId} username={username} displayName={profile.displayName} />;
}
