import { MailShell } from "@/components/mail/MailShell";

export default function MailLayout({ children }: LayoutProps<"/mail">) {
  return <MailShell>{children}</MailShell>;
}
