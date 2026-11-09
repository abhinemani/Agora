import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Ledger } from "@/components/Ledger";
import { StoreProvider } from "@/components/store";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agora: find what your agency needs",
  description: "Agora: one marketplace where any city, county, or district can search state and cooperative contracts, see which it may use, and buy.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
      </head>
      <body className="min-h-screen overflow-x-clip antialiased">
        <StoreProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <footer className="mt-10 border-t border-line px-4 py-6 text-center text-[11px] text-[#8795a9]">
            Agora · Cooperative purchasing concept · Tyler and Maximus data from NJSTART price schedules · Sourcewell prices require a separate vendor quote
          </footer>
          <Ledger />
        </StoreProvider>
      </body>
    </html>
  );
}
