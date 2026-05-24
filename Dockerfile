# Campaign Dashboard — production image for Dokploy / Docker
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pandas \
    python3-requests \
    python3-shapely \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs --no-create-home nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/district-engine ./district-engine
COPY --from=builder --chown=nextjs:nodejs /app/geodata ./geodata
COPY --from=builder --chown=nextjs:nodejs /app/geomodule ./geomodule

# Must run as root: /app is root-owned; nextjs cannot mkdir here after USER nextjs.
# install -d sets owner in one step (avoids separate chown -R that failed on some builders).
RUN install -d -o nextjs -g nodejs -m 0755 \
    credentials \
    data/bq-snapshots \
    data/district-classifier/jobs \
    data/district-classifier/uploads \
    data/district-classifier/exports \
    data/district-sort-cache \
    pdi-mappings \
    pdi-sync-exports

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
