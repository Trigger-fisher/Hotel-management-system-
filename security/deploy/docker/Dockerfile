# The HMS web app as a container (security plan 2026-11-01, section 5). Build from the REPOSITORY ROOT (the app imports ../common/ui-shared):
#   docker build -f security/deploy/docker/Dockerfile -t hms:local .
# NOT BUILT ANYWHERE YET (written before the VPS exists). Runs as the unprivileged user "node" (uid 1000), never as root.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY common ./common
COPY web-app/package.json web-app/package-lock.json ./web-app/
WORKDIR /repo/web-app
RUN npm ci --no-audit --no-fund
COPY web-app ./
ARG HMS_BUILD_ID=docker
ENV HMS_BUILD_ID=$HMS_BUILD_ID NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/web-app
USER node
EXPOSE 3000
# `node ... next start` instead of `npm run start`: npm would write logs into the home folder, which is read-only in the compose file
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
