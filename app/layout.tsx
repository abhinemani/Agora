import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { Ledger } from "@/components/Ledger";
import { StoreProvider } from "@/components/store";
import "./globals.css";

export const metadata: Metadata = {
  title: "Riverbend Storefront",
  description: "Marketplace 2.0 prototype: one local government's storefront, its suppliers, and the revenue mechanics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600;700&display=swap" />
      </head>
      <body className="min-h-screen overflow-x-clip antialiased">
        <StoreProvider>
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
          <Ledger />
        </StoreProvider>
      </body>
    </html>
  );
}
