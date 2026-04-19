FROM node:22-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY patches ./patches
RUN npm ci --ignore-scripts

COPY . .

RUN npx esbuild server/index.ts \
    --platform=node \
    --packages=external \
    --bundle \
    --format=esm \
    --outdir=server_dist


FROM node:22-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY patches ./patches
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/server_dist ./server_dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/drizzle.config.ts ./

EXPOSE 5000

CMD ["node", "server_dist/index.js"]
