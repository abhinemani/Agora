/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse, xlsx and mammoth read files at runtime; keep them out of the server bundle.
  serverExternalPackages: ["pdf-parse", "xlsx", "mammoth"],
};
export default nextConfig;
