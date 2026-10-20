/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared package ships plain ESM source; let Next compile it.
  transpilePackages: ['@olw/shared'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
