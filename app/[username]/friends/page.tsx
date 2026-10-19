import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { validateUsername } from "@/lib/validation";

// Placeholder. A later task builds the full friends list.
export default async function FriendsPage({ params }: PageProps<"/[username]/friends">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();
  return (
    <Box title="Friends">
      <p>The full friends list is coming in a later update.</p>
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
