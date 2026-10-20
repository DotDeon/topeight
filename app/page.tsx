import Link from "next/link";
import { Box } from "@/components/Box";
import { CoolNewMusic, CoolNewPeople } from "@/components/HomeCool";
import { HomeBulletins, MemberPanel } from "@/components/HomeMember";
import { UpcomingShows } from "@/components/HomeShows";
import styles from "@/components/Home.module.css";

export default function Home() {
  return (
    <div className={styles.home}>
      <div className={styles.left}>
        <div className={styles.banner}>
          Welcome to TopEight. Make your profile, add your friends, play your music.
        </div>
        <HomeBulletins />
        <CoolNewPeople />
        <CoolNewMusic />
        <Box title="TopEight Announcements" color="blue">
          <ul className={styles.list}>
            <li><Link href="/signup">Upload your tracks to your artist profile</Link></li>
            <li><Link href="/edit">New: custom profile code for artists</Link></li>
            <li><Link href="/safety">Read the safety tips</Link></li>
          </ul>
        </Box>
      </div>
      <div className={styles.right}>
        <MemberPanel />
        <UpcomingShows />
      </div>
    </div>
  );
}
