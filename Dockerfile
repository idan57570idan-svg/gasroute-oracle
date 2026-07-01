FROM oven/bun:1.3 AS runtime

WORKDIR /app

# Install deps first for layer caching
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

COPY tsconfig.json ./
COPY src/ ./src/

ENV NODE_ENV=production
ENV PORT=8080

# Defaults for x402 payment (override via env on deployment)
ENV FACILITATOR_URL=https://facilitator.daydreams.systems
ENV NETWORK=base-sepolia
ENV DEFAULT_PRICE=1000

EXPOSE 8080

CMD ["bun", "run", "src/server.ts"]
