# ═══════════════════════════════════════════════════════
# Soul AI — Production Docker Image
# Multi-stage build for minimal image size
# ═══════════════════════════════════════════════════════

# Stage 1: Build
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Build
RUN npm run build

# Stage 2: Production
FROM node:20-slim AS production

WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install production only
RUN npm ci --omit=dev && npm cache clean --force

# Remove build tools after native module compilation
RUN apt-get purge -y python3 make g++ && apt-get autoremove -y

# Copy built output
COPY --from=builder /app/dist ./dist

# Create data directory
RUN mkdir -p /data && chown -R node:node /data

# Switch to non-root user
USER node

# Soul database lives in /data (mount as volume)
ENV SOUL_DB_PATH=/data/soul.db
ENV SOUL_HOST=0.0.0.0
ENV SOUL_PORT=47779

# Expose HTTP API + Web UI
EXPOSE 47779

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:47779/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Default: run HTTP server (MCP mode = override CMD)
CMD ["node", "dist/server.js"]
