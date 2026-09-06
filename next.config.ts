import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  experimental: {
    // Upload ceiling for every route the middleware touches — which is ALL of
    // /api (src/middleware.ts matches them deliberately: most route handlers
    // have no auth guard of their own).
    //
    // Next clones the request body to hand a copy to the middleware, and past
    // this limit it does NOT reject the request — it TRUNCATES the clone, warns
    // "Request body exceeded 10MB for <path>", and lets the handler run on a cut
    // body. The handler then dies on `request.formData()` with "failed to parse
    // body as FormData", which reads like a client bug and is not one.
    //
    // Default is 10MB, which every real photo batch blew past. Aligned here with
    // nginx's `client_max_body_size 200m` (nginx/nginx.conf) so exactly one layer
    // decides, and it answers with a clean 413 instead of a silent truncation.
    // The per-file cap the app enforces (MAX_FILE_SIZE_MB, 100) stays the limit
    // users actually meet. Cost: an in-flight upload is buffered in memory up to
    // this size, so lower it if the app server gets tight on RAM.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
