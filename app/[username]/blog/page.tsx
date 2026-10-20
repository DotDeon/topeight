import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { UserBlog } from "@/components/blog/UserBlog";
import { api } from "@/convex/_generated/api";
import { validateUsername } from "@/lib/validation";

export default async function BlogPage({ params }: PageProps<"/[username]/blog">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();

  const profile = await fetchQuery(api.profiles.profileHeader, { username });
  if (profile === null || profile.banned) notFound();

  return (
    <Box title={`${profile.displayName}'s Blog`}>
      <UserBlog username={username} />
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
