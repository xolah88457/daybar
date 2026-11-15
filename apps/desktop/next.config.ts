import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'export', images: { unoptimized: true },
  transpilePackages: ['@daybar/core'],
};
export default nextConfig;
