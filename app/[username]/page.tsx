import { fetchQuery } from "convex/nextjs";
import { notFound, redirect } from "next/navigation";
import { Box } from "@/components/Box";
import { ProfileView } from "@/components/ProfileView";
import { api } from "@/convex/_generated/api";
import { currentMinute } from "@/lib/minute";
import { validateUsername } from "@/lib/validation";
import { viewerAuth } from "@/lib/viewerToken";

export default async function ProfilePage({ params }: PageProps<"/[username]">) {
  const { username: raw } = await params;
  const checked = validateUsername(raw);
  if (!checked.ok) notFound();
  if (checked.username !== raw) redirect(`/${checked.username}`);

  // As the viewer: a friend gets a private profile's track list, a stranger gets [] and the card.
  const auth = await viewerAuth();
  const [profile, tracks, profileSong] = await Promise.all([
    fetchQuery(api.profiles.profileHeader, { username: checked.username }, auth),
    fetchQuery(api.profiles.profileTrackTitles, { username: checked.username }, auth),
    fetchQuery(api.profiles.profileSongForReport, { username: checked.username }, auth),
  ]);
  if (profile === null) notFound();
  if (profile.banned) {
    return (
      <Box title="Profile">
        <p>This profile is unavailable</p>
      </Box>
    );
  }
  let card = null;
  if (profile.restricted) {
    const p = await fetchQuery(
      api.profiles.getPublicProfile,
      { username: checked.username, asOf: currentMinute() },
      auth,
    );
    if (p === null || "unavailable" in p) notFound();
    if ("restricted" in p) {
      const { displayName, photoUrl, age, location, mood, online } = p;
      card = { displayName, photoUrl, ...(age !== undefined ? { age } : {}), location, mood, online };
    }
  }
  return (
    <ProfileView
      username={checked.username}
      displayName={profile.displayName}
      tracks={tracks}
      profileSong={profileSong}
      isPrivate={profile.private}
      card={card}
    />
  );
}
