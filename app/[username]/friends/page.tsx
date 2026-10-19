import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { FriendsList } from "@/components/FriendsList";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";

export default async function FriendsPage({ params }: PageProps<"/[username]/friends">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  const [profile, list] = await Promise.all([
    fetchQuery(api.profiles.getPublicProfile, { username }),
    fetchQuery(api.social.listFriends, { username }),
  ]);
  if (profile === null || "unavailable" in profile || list === null) notFound();

  return (
    <Box title={`${profile.displayName}'s Friends`}>
      <p>
        <b>{profile.displayName}</b> has <span data-friends-total="">{list.total}</span> friends.
      </p>
      <FriendsList friends={list.friends} />
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
