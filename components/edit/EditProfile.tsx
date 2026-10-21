"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { Box } from "../Box";
import { BandForm, DetailsForm } from "./DetailsForm";
import { ArtistProComingSoon } from "./ArtistProComingSoon";
import { CodeEditor } from "./CodeEditor";
import styles from "./Edit.module.css";
import { FriendsAndBlocking } from "./FriendsAndBlocking";
import { MailSetting } from "./MailSetting";
import { MoodForm } from "./MoodForm";
import { OnlineSetting } from "./OnlineSetting";
import { PrivateSetting } from "./PrivateSetting";
import { PhotoForm } from "./PhotoForm";
import { ProfileSongForm } from "./ProfileSongForm";
import { ShowsForm } from "./ShowsForm";
import { StatusLine, useSaver } from "./shared";
import { Top8Picker } from "./Top8Picker";
import { TracksForm } from "./TracksForm";

/** The confirm before switching to artist. A private fan is told the setting goes. */
export function becomeArtistConfirm(isPrivate: boolean): string {
  return isPrivate
    ? "Artist pages are public. Switching turns off your private profile setting. Continue?"
    : "Switch to an artist profile?";
}

function BecomeArtist({ isPrivate }: { isPrivate: boolean }) {
  const become = useMutation(api.profiles.becomeArtist);
  const { status, busy, run } = useSaver();
  return (
    <Box title="Artist Profile" color="blue">
      <p className={styles.note}>Artists get a music player, upcoming shows, band details and custom HTML and JavaScript.</p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirm(becomeArtistConfirm(isPrivate))) void run(() => become({}), "You are now an artist");
          }}
        >
          Switch to an artist profile
        </button>
        <StatusLine status={status} />
      </div>
    </Box>
  );
}

export function EditProfile() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.profiles.me, isAuthenticated ? {} : "skip");
  // Small reads instead of the whole public profile: only the song and photo are needed here.
  const song = useQuery(api.profileSongs.mine, me ? {} : "skip");
  const photoUrl = useQuery(api.profiles.myPhotoUrl, me ? {} : "skip");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
    else if (isAuthenticated && me === null) router.replace("/signup");
  }, [isLoading, isAuthenticated, me, router]);

  if (isLoading || !isAuthenticated || !me) return <p className={styles.note}>Loading...</p>;

  const artist = me.kind === "artist";
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Edit Profile</h1>
      {artist && <ArtistProComingSoon />}
      <DetailsForm key={me._id} me={me} />
      <Box title="Mood" color="orange">
        <MoodForm key={me._id} mood={me.mood} label="Profile mood" />
      </Box>
      <PhotoForm photoUrl={photoUrl ?? null} photoKey={me.photoKey} />
      <ProfileSongForm
        song={song ?? null}
        hasPick={me.profileSong !== undefined}
        loading={song === undefined}
        artist={artist}
        shareSongs={me.shareSongs !== false}
      />
      <Top8Picker top8={me.top8} />
      <FriendsAndBlocking />
      <MailSetting key={me._id} mailFrom={me.mailFrom} />
      <OnlineSetting showOnline={me.showOnline} />
      {!artist && <PrivateSetting isPrivate={me.private} />}
      {artist ? (
        <>
          <TracksForm />
          <ShowsForm />
          <BandForm me={me} />
        </>
      ) : (
        <BecomeArtist isPrivate={me.private === true} />
      )}
      <CodeEditor key={`${me._id}-${me.kind}`} me={me} />
    </div>
  );
}
