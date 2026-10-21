import { Box } from "@/components/Box";

// Only these names are ever shown. Anything else gets the generic line.
const FEATURES: Record<string, string> = {
  invite: "Invite",
  mail: "Mail",
  blog: "Blog",
  favorites: "Favorites",
  groups: "Groups",
  events: "Events",
  videos: "Videos",
  "send message": "Send Message",
  "forward to friend": "Forward to Friend",
};

export default async function ComingSoonPage({ searchParams }: PageProps<"/coming-soon">) {
  const { f } = await searchParams;
  const key = typeof f === "string" ? f.toLowerCase() : "";
  const name = Object.hasOwn(FEATURES, key) ? FEATURES[key] : null;
  return (
    <Box title="Coming Soon">
      <p>{name ? `${name} is coming soon` : "That feature is coming soon"}</p>
    </Box>
  );
}
