import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { PostPage } from "@/components/blog/PostPage";
import { PrivateNotice } from "@/components/PrivateProfile";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";
import { viewerAuth } from "@/lib/viewerToken";

export default async function Page({ params }: PageProps<"/[username]/blog/[postId]">) {
  const { username, postId } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  // As the viewer: blog.get is null on a private profile for anyone but its friends.
  const auth = await viewerAuth();
  const [profile, post] = await Promise.all([
    fetchQuery(api.profiles.profileHeader, { username }, auth),
    fetchQuery(api.blog.get, { id: postId }, auth),
  ]);
  if (profile === null || profile.banned) notFound();
  if (profile.restricted) {
    return (
      <Box title={`${profile.displayName}'s Blog`}>
        <PrivateNotice displayName={profile.displayName} />
        <p>
          <Link href={`/${username}`}>Back to the profile</Link>
        </p>
      </Box>
    );
  }
  if (post === null || post.author.username !== username) notFound();

  return <PostPage id={postId} username={username} displayName={profile.displayName} />;
}
