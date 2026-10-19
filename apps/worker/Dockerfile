# Builds the birdsI worker as a single Node process.
# Build from the repository root: docker build -f apps/worker/Dockerfile .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/db/package.json packages/db/
COPY packages/cli/package.json packages/cli/
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build --workspace=apps/worker

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/worker/dist ./dist
CMD ["node", "dist/main.js"]
