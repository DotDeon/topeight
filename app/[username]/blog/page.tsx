import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { UserBlog } from "@/components/blog/UserBlog";
import { PrivateNotice } from "@/components/PrivateProfile";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";
import { viewerAuth } from "@/lib/viewerToken";

export default async function BlogPage({ params }: PageProps<"/[username]/blog">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  // As the viewer, to learn whether they only get the private notice. The posts load on the client, signed in.
  const profile = await fetchQuery(api.profiles.profileHeader, { username }, await viewerAuth());
  if (profile === null || profile.banned) notFound();

  return (
    <Box title={`${profile.displayName}'s Blog`}>
      {profile.restricted ? <PrivateNotice displayName={profile.displayName} /> : <UserBlog username={username} />}
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
