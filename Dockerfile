# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-slim

WORKDIR /app

# Copy built output and dependencies
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Cloud Run uses PORT env (default 8080)
ENV PORT=8080
EXPOSE 8080

# Run the MCP server (stdio) - for Cloud Run we need HTTP, so we use the HTTP server
CMD ["node", "build/server.js"]
