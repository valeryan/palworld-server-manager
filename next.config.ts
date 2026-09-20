import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["drizzle-orm"],
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": ["./dist-standalone/**/*", "./release/**/*"],
  },
};

export default nextConfig;
