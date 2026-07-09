import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Standalone app nested under fide-internal: own lockfile + node_modules.
// Pin Turbopack/tracing here so Next does not walk up to the parent turborepo.
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const basePath = process.env.IS_DEMO === "1" ? "/demo" : "";

const nextConfig: NextConfig = {
  // Keep file tracing inside this app (do not pull parent monorepo packages).
  outputFileTracingRoot: appRoot,
  turbopack: {
    root: appRoot,
  },
  serverExternalPackages: ["@electric-sql/pglite", "@vercel/otel"],
  ...(basePath
    ? {
        basePath,
        assetPrefix: "/demo-assets",
        redirects: async () => [
          {
            source: "/",
            destination: basePath,
            permanent: false,
            basePath: false,
          },
        ],
      }
    : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  cacheComponents: true,
  devIndicators: false,
  poweredByHeader: false,
  reactCompiler: true,
  logging: {
    fetches: {
      fullUrl: false,
    },
    incomingRequests: false,
  },
  images: {
    remotePatterns: [
      {
        hostname: "avatar.vercel.sh",
      },
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
  experimental: {
    prefetchInlining: true,
    cachedNavigations: true,
    appNewScrollHandler: true,
    inlineCss: true,
    turbopackFileSystemCacheForDev: true,
  },
};

export default withBotId(nextConfig);
