/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse, xlsx, mammoth, word-extractor and pdf-lib read files at runtime; keep them out of the server bundle.
  serverExternalPackages: ["pdf-parse", "xlsx", "mammoth", "pg", "word-extractor", "pdf-lib"],
  // Riverbend's city marketplace briefly lived under /storefronts, which now means supplier pages.
  async redirects() {
    return [{ source: "/storefronts/riverbend", destination: "/marketplaces/riverbend", permanent: false }];
  },
};
export default nextConfig;
