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

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs --no-create-home nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Must run as root: /app is root-owned; nextjs cannot mkdir here after USER nextjs.
# install -d sets owner in one step (avoids separate chown -R that failed on some builders).
RUN install -d -o nextjs -g nodejs -m 0755 \
    credentials \
    data/bq-snapshots \
    pdi-mappings \
    pdi-sync-exports

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
