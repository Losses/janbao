FROM oven/bun:1.3 AS deps
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock .npmrc ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.3 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV ADAPTER=node
RUN bun run build

FROM oven/bun:1.3 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	BODY_SIZE_LIMIT=50000000 \
	LOCAL_DB_PATH=/data/janbao.db
COPY package.json bun.lock .npmrc ./
RUN bun install --production --frozen-lockfile
COPY --from=build /app/build ./build
COPY drizzle/local-migrations ./drizzle/local-migrations
VOLUME ["/data"]
EXPOSE 3000
CMD ["bun", "./build/index.js"]
