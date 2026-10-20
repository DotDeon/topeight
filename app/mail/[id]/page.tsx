import { MessageView } from "@/components/mail/MessageView";

export default async function Page({ params }: PageProps<"/mail/[id]">) {
  const { id } = await params;
  return <MessageView id={id} />;
}
