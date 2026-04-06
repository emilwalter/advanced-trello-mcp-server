# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install production deps + esbuild for transpilation (skip vitest and other test-only deps)
RUN npm install --omit=dev && npm install esbuild

# Copy source and build
COPY . .
RUN npm run build

# Runtime stage
FROM node:20-slim

WORKDIR /app

# Copy built output and install only production deps
COPY --from=builder /app/build ./build
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Cloud Run uses PORT env (default 8080)
ENV PORT=8080
EXPOSE 8080

# Run the MCP server (stdio) - for Cloud Run we need HTTP, so we use the HTTP server
CMD ["node", "build/server.js"]
