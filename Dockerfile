FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build

FROM node:22-slim

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist/ ./dist/
COPY hooks/ ./hooks/

ENV REKINDLE_DB_PATH=/data/memories.db

RUN mkdir -p /data

ENTRYPOINT ["node", "dist/index.js"]
