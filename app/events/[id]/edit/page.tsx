import { EditEvent } from "@/components/events/WritePages";

export default async function Page({ params }: PageProps<"/events/[id]/edit">) {
  const { id } = await params;
  return <EditEvent id={id} />;
}
