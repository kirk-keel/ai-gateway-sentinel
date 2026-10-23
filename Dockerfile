# ==========================================
# Stage 1: Build
# ==========================================
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy dependency manifests
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# Remove development dependencies to keep production footprint minimal
RUN npm prune --omit=dev

# ==========================================
# Stage 2: Hardened Production Runtime
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

# Install tini for clean signal forwarding & curl for container health checks
RUN apk add --no-cache tini curl

# Environment defaults
ENV NODE_ENV=production \
    PORT=8000 \
    HOST=0.0.0.0

# Copy compiled artifacts and production dependencies from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Harden security: run as non-root built-in node user
USER node

# Expose Sentinel HTTP & Metrics port
EXPOSE 8000

# Health check probe
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
