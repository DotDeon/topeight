import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { NavBar } from "@/components/NavBar";
import { SuspendedGate } from "@/components/SuspendedGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "TopEight",
  description: "A place for friends.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body>
          <ConvexClientProvider>
            <div className="site">
              <Header />
              <NavBar />
              <div className="site-main">
                <SuspendedGate>{children}</SuspendedGate>
              </div>
              <Footer />
            </div>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
