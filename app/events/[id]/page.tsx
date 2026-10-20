import { EventPage } from "@/components/events/EventPage";

export default async function Page({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  return <EventPage id={id} />;
}
