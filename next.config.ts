import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: false },
      { source: "/login", destination: "/signin", permanent: false },
    ];
  },
};

export default nextConfig;
