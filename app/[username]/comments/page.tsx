import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { CommentsList } from "@/components/CommentsList";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";

export default async function CommentsPage({ params }: PageProps<"/[username]/comments">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  const [profile, profileId] = await Promise.all([
    fetchQuery(api.profiles.getPublicProfile, { username }),
    fetchQuery(api.social.profileIdByUsername, { username }),
  ]);
  if (profile === null || "unavailable" in profile || profileId === null) notFound();

  return (
    <Box title={`${profile.displayName}'s Friends Comments`}>
      <CommentsList username={username} profileId={profileId} />
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
