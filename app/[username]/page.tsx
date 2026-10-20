import { fetchQuery } from "convex/nextjs";
import { notFound, redirect } from "next/navigation";
import { Box } from "@/components/Box";
import { ProfileView } from "@/components/ProfileView";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";

export default async function ProfilePage({ params }: PageProps<"/[username]">) {
  const { username: raw } = await params;
  const checked = validateUsername(raw);
  if (!checked.ok) notFound();
  if (checked.username !== raw) redirect(`/${checked.username}`);

  const [profile, tracks, profileSong] = await Promise.all([
    fetchQuery(api.profiles.profileHeader, { username: checked.username }),
    fetchQuery(api.profiles.profileTrackTitles, { username: checked.username }),
    fetchQuery(api.profiles.profileSongForReport, { username: checked.username }),
  ]);
  if (profile === null) notFound();
  if (profile.banned) {
    return (
      <Box title="Profile">
        <p>This profile is unavailable</p>
      </Box>
    );
  }
  return <ProfileView username={checked.username} displayName={profile.displayName} tracks={tracks} profileSong={profileSong} />;
}
