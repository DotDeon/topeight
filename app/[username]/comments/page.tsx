import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { CommentsList } from "@/components/CommentsList";
import { PrivateNotice } from "@/components/PrivateProfile";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";
import { viewerAuth } from "@/lib/viewerToken";

export default async function CommentsPage({ params }: PageProps<"/[username]/comments">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  // As the viewer, so a private profile's friends get the comments and the box.
  const auth = await viewerAuth();
  const [profile, profileId] = await Promise.all([
    fetchQuery(api.profiles.profileHeader, { username }, auth),
    fetchQuery(api.social.profileIdByUsername, { username }, auth),
  ]);
  if (profile === null || profile.banned || profileId === null) notFound();

  return (
    <Box title={`${profile.displayName}'s Friends Comments`}>
      {profile.restricted ? (
        <PrivateNotice displayName={profile.displayName} />
      ) : (
        <CommentsList username={username} profileId={profileId} />
      )}
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
