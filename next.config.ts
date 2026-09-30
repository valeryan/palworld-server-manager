import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["drizzle-orm"],
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*", "./src/server/mods/lua/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": ["./.data-next/**/*", "./dist-standalone/**/*", "./release/**/*"],
  },
};

export default nextConfig;
