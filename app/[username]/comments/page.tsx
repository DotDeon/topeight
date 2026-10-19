import Link from "next/link";
import { notFound } from "next/navigation";
import { Box } from "@/components/Box";
import { validateUsername } from "@/lib/validation";

// Placeholder. A later task builds the full comments list.
export default async function CommentsPage({ params }: PageProps<"/[username]/comments">) {
  const { username } = await params;
  const checked = validateUsername(username);
  if (!checked.ok || checked.username !== username) notFound();
  return (
    <Box title="Comments">
      <p>The full comments list is coming in a later update.</p>
      <p>
        <Link href={`/${username}`}>Back to the profile</Link>
      </p>
    </Box>
  );
}
