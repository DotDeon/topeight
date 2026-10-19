import { Box } from "@/components/Box";
import { BrowseResults } from "@/components/BrowseResults";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function BrowsePage({ searchParams }: PageProps<"/browse">) {
  const sp = await searchParams;
  const k = first(sp.kind);
  const kind = k === "fan" || k === "artist" ? k : undefined;
  const location = first(sp.location).trim().slice(0, 100);
  const genre = first(sp.genre).trim().slice(0, 100);
  return (
    <Box title="Browse Users">
      <form action="/browse" method="get">
        <label>
          Show:{" "}
          <select name="kind" defaultValue={kind ?? ""}>
            <option value="">Everyone</option>
            <option value="fan">People</option>
            <option value="artist">Music</option>
          </select>
        </label>{" "}
        <label>
          Location: <input name="location" maxLength={100} defaultValue={location} />
        </label>{" "}
        <label>
          Genre: <input name="genre" maxLength={100} defaultValue={genre} />
        </label>{" "}
        <button type="submit">Browse</button>
      </form>
      <BrowseResults kind={kind} location={location} genre={genre} />
    </Box>
  );
}
