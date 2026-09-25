# syntax=docker/dockerfile:1

# ---- build everything ------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
# Optional build-time settings for the bundled web client.
ARG VITE_SERVER_URL=""
ARG VITE_BASE="/"
ENV VITE_SERVER_URL=$VITE_SERVER_URL VITE_BASE=$VITE_BASE
RUN npm run build && npm prune --omit=dev && npm cache clean --force

# ---- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=2567
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY apps/server/package.json apps/server/
COPY apps/server/drizzle apps/server/drizzle
COPY apps/server/scripts apps/server/scripts
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
USER node
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
