import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Ledger } from "@/components/Ledger";
import { SiteFooter } from "@/components/SiteFooter";
import { StoreProvider } from "@/components/store";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agora: find what your agency needs",
  description: "Agora: one marketplace where any city, county, or district can search state and cooperative contracts, see which it may use, and buy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply a saved Light or Dark choice before first paint, so there's no flash. "System" leaves it to the OS. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:ital,wght@0,400;0,600;0,700;1,400&family=Merriweather:wght@400;700&family=Roboto+Mono:wght@400;700&display=swap" />
      </head>
      <body className="min-h-screen overflow-x-clip antialiased">
        <StoreProvider>
          <Header />
          <div aria-hidden className="bp-fade" />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <SiteFooter />
          <Ledger />
        </StoreProvider>
      </body>
    </html>
  );
}
