import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot: path.join(__dirname),
  images: { unoptimized: true },
  trailingSlash: true,
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, os: false, path: false, crypto: false };
    return config;
  },
};

export default nextConfig;
