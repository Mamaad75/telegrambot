/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared package ships TypeScript-compiled CommonJS; Next transpiles it for both
  // the server and the browser bundles.
  transpilePackages: ['@baimar/shared'],
  // Standalone output keeps the production image small enough for a 2 CPU / 4 GB VPS.
  output: 'standalone',
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
