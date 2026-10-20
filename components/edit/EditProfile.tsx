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
import { PhotoForm } from "./PhotoForm";
import { ProfileSongForm } from "./ProfileSongForm";
import { ShowsForm } from "./ShowsForm";
import { StatusLine, useSaver } from "./shared";
import { Top8Picker } from "./Top8Picker";
import { TracksForm } from "./TracksForm";

function BecomeArtist() {
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
            if (confirm("Switch to an artist profile?")) void run(() => become({}), "You are now an artist");
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
  const pub = useQuery(api.profiles.getPublicProfile, me ? { username: me.username } : "skip");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/login");
    else if (isAuthenticated && me === null) router.replace("/signup");
  }, [isLoading, isAuthenticated, me, router]);

  if (isLoading || !isAuthenticated || !me) return <p className={styles.note}>Loading...</p>;

  const artist = me.kind === "artist";
  const photoUrl = pub && !("unavailable" in pub) ? pub.photoUrl : null;
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Edit Profile</h1>
      {artist && <ArtistProComingSoon />}
      <DetailsForm key={me._id} me={me} />
      <Box title="Mood" color="orange">
        <MoodForm key={me._id} mood={me.mood} label="Profile mood" />
      </Box>
      <PhotoForm photoUrl={photoUrl} photoKey={me.photoKey} />
      <ProfileSongForm
        song={pub && !("unavailable" in pub) && pub.profileSong ? pub.profileSong : null}
        hasPick={me.profileSong !== undefined}
        loading={pub === undefined}
        artist={artist}
        shareSongs={me.shareSongs !== false}
      />
      <Top8Picker top8={me.top8} />
      <FriendsAndBlocking />
      <MailSetting key={me._id} mailFrom={me.mailFrom} />
      <OnlineSetting showOnline={me.showOnline} />
      {artist ? (
        <>
          <TracksForm />
          <ShowsForm />
          <BandForm me={me} />
        </>
      ) : (
        <BecomeArtist />
      )}
      <CodeEditor key={`${me._id}-${me.kind}`} me={me} />
    </div>
  );
}
