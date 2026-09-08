# ---------------------------------------------------------------------------
# Baimar Lead Intelligence — API and worker image
#
# Multi-stage so the runtime image carries only production dependencies and the
# compiled output. Runs as a non-root user.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
# Prisma needs OpenSSL to pick the right query engine on Alpine.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
# Generate the Prisma client first (tsc needs its types), compile, then drop the
# dev dependencies and regenerate so the runtime image carries only what it runs.
RUN npm run build -w @baimar/shared \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npx tsc -p apps/api/tsconfig.json \
 && npm prune --omit=dev \
 && npx prisma generate --schema apps/api/prisma/schema.prisma

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl tini \
 && addgroup -S baimar && adduser -S baimar -G baimar
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/package.json ./package.json
COPY docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod +x /usr/local/bin/api-entrypoint.sh && chown -R baimar:baimar /app

USER baimar
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini reaps zombies so a crashed crawler subprocess cannot linger.
ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/api-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
