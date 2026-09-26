import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["drizzle-orm"],
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": ["./.data-next/**/*", "./dist-standalone/**/*", "./release/**/*"],
  },
};

export default nextConfig;
