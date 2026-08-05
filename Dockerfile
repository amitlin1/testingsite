# ===========================================
# Production Dockerfile for Next.js
# Standard online build - downloads from npm
# ===========================================

ARG NODE_VERSION=22.14.0

# ============ Stage 1: Dependencies ============
FROM node:${NODE_VERSION}-bullseye-slim AS deps

WORKDIR /app

ENV npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies from npm registry
RUN npm ci

# ============ Stage 2: Builder ============
FROM node:${NODE_VERSION}-bullseye-slim AS builder

WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Set production environment for build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# NO build-time app config. `next build` inlines every NEXT_PUBLIC_* var it sees
# into the static JS bundle, which would pin this image to ONE environment — the
# image built here would carry that URL into production and no .env edit could
# change it. The image must stay environment-neutral so the same tar deploys to
# any air-gapped site.
#
# The two values that used to be baked in are now resolved per-request on the
# server and handed to the browser:
#   - Keycloak issuer   → /api/logout                (AUTH_KEYCLOAK_ISSUER)
#   - OnlyOffice origin → /api/onlyoffice/config     (ONLYOFFICE_PUBLIC_URL)
# Adding a NEXT_PUBLIC_* var here re-introduces the problem — don't.

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN npm run build

# ============ Stage 3: Runner ============
FROM node:${NODE_VERSION}-bullseye-slim AS runner

WORKDIR /app

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid 1001 nextjs

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy standalone output from builder
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Switch to non-root user
USER nextjs

EXPOSE 3000

# Probe the public liveness route — "/" is auth-gated and answers 401 to a
# cookie-less probe (see src/app/api/health/route.ts).
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
