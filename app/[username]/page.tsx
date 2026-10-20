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

  const profile = await fetchQuery(api.profiles.getPublicProfile, { username: checked.username });
  if (profile === null) notFound();
  if ("unavailable" in profile) {
    return (
      <Box title="Profile">
        <p>This profile is unavailable</p>
      </Box>
    );
  }
  // Only ids and titles: the report dialog looks up songs here, never in the frame.
  const tracks = profile.tracks.map((t) => ({ id: t.id, title: t.title }));
  return <ProfileView username={profile.username} displayName={profile.displayName} tracks={tracks} />;
}
