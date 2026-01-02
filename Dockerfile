FROM node:20 AS builder
WORKDIR /app

# Copy package files first for better layer caching
# This layer will be cached unless package.json or package-lock.json changes
COPY package.json package-lock.json ./

# Copy workspace packages (needed for npm workspaces)
# Copy packages directory before install so npm can resolve workspace dependencies
COPY packages ./packages

# Install dependencies with npm install
# Using npm install instead of npm ci because package-lock.json may be out of sync
# Use cache mount for faster subsequent builds
# --no-audit skips security audit (faster, can run separately if needed)
# --legacy-peer-deps handles peer dependency conflicts more gracefully
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --legacy-peer-deps

# Copy build configuration files
COPY tsconfig.json tsdown.config.ts turbo.json jest.config.js jest.resolver.cjs ./

# Copy source code (this layer changes frequently, so it's after dependency install)
COPY scripts ./scripts
COPY src ./src
COPY mcp-server ./mcp-server
COPY assets ./assets

# Build the project
RUN npm run build

FROM node:20-slim
WORKDIR /app

# Copy built artifacts and runtime deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

ENV HOST=0.0.0.0
ENV PORT=3004
EXPOSE 3004

CMD ["node", "dist/mcp-server.js"]

