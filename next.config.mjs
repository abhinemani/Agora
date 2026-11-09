/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse, xlsx and mammoth read files at runtime; keep them out of the server bundle.
  serverExternalPackages: ["pdf-parse", "xlsx", "mammoth"],
  // Riverbend's city marketplace briefly lived under /storefronts, which now means supplier pages.
  async redirects() {
    return [{ source: "/storefronts/riverbend", destination: "/marketplaces/riverbend", permanent: false }];
  },
};
export default nextConfig;
