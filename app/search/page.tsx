import { Box } from "@/components/Box";
import { SearchResults } from "@/components/SearchResults";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const q = first(sp.q).trim().slice(0, 100);
  const type = first(sp.type);
  const kind =
    type === "people"
      ? "fan"
      : type === "music"
        ? "artist"
        : type === "venues"
          ? "venue"
          : type === "labels"
            ? "label"
            : undefined;
  return (
    <Box title={`Search results for "${q}"`}>
      <SearchResults q={q} kind={kind} />
    </Box>
  );
}
