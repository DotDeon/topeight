import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { FriendsList } from "@/components/FriendsList";
import { PrivateNotice } from "@/components/PrivateProfile";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";
import { viewerAuth } from "@/lib/viewerToken";

export default async function FriendsPage({ params }: PageProps<"/[username]/friends">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  // As the viewer, so a private profile's friends get the list.
  const auth = await viewerAuth();
  const [profile, list] = await Promise.all([
    fetchQuery(api.profiles.profileHeader, { username }, auth),
    fetchQuery(api.social.listFriends, { username }, auth),
  ]);
  if (profile === null || profile.banned || list === null) notFound();

  return (
    <Box title={`${profile.displayName}'s Friends`}>
      {profile.restricted ? (
        // listFriends comes back empty here, so no "has 0 friends".
        <PrivateNotice displayName={profile.displayName} />
      ) : (
        <>
          <p>
            <b>{profile.displayName}</b> has <span data-friends-total="">{list.total}</span> friends.
          </p>
          <FriendsList friends={list.friends} />
        </>
      )}
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
