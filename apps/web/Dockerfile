# ---------------------------------------------------------------------------
# Baimar Lead Intelligence — web dashboard image
#
# Uses Next.js standalone output, which traces only the files the server
# actually needs. The result is small enough to build and run on a modest VPS.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
# The API URL is inlined into the client bundle at build time.
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @baimar/shared && npm run build -w @baimar/web

FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S baimar && adduser -S baimar -G baimar
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=baimar:baimar /app/apps/web/.next/standalone ./
COPY --from=build --chown=baimar:baimar /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=baimar:baimar /app/apps/web/public ./apps/web/public

USER baimar
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
