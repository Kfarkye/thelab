FROM node:22-alpine AS base

# Install deps
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json ./
RUN npm install --legacy-peer-deps

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV GOOGLE_CLOUD_PROJECT=workflowos-a0fbf
ENV VERTEX_AI_AYAOPS_URL_DATASTORE=projects/1049576459547/locations/global/collections/default_collection/dataStores/ayaops-candidate-urls-basic-v1
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GOOGLE_CLOUD_PROJECT=workflowos-a0fbf
ENV VERTEX_AI_AYAOPS_URL_DATASTORE=projects/1049576459547/locations/global/collections/default_collection/dataStores/ayaops-candidate-urls-basic-v1
ENV GOOGLE_MAPS_API_KEY=AIzaSyDmpKrf4fuxvuMUOYWH8RPEgEHA3FPlY6I

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
