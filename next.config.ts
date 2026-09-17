import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  experimental: {
    // Body ceiling for every route the middleware touches — which is ALL of
    // /api (src/middleware.ts matches them deliberately: most route handlers
    // have no auth guard of their own).
    //
    // Next clones the request body to hand a copy to the middleware, and past
    // this limit it does NOT reject the request — it TRUNCATES the clone, warns
    // "Request body exceeded 10MB for <path>", and lets the handler run on a cut
    // body, which then fails in a way that reads like a client bug and is not one.
    //
    // File uploads no longer pass through here at all: the browser POSTs them
    // straight to MinIO with a presigned ticket (docs/STORAGE.md, "Direct
    // uploads"), so the largest body left is the inline text editor's JSON
    // (MAX_TEXT_EDIT_SIZE_MB, 5) and a base64 signature. 25mb keeps 5x headroom
    // over that while bounding what one request can pin in memory. Aligned with
    // nginx's `client_max_body_size 25m` (nginx/nginx.conf).
    proxyClientMaxBodySize: "25mb",
  },
};

export default nextConfig;
