# ========================================================
# Express Backend Production Dockerfile
# ========================================================

FROM node:20-alpine AS runner

WORKDIR /app

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=8000

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source code
COPY . .

# Run as non-root user for security
USER node

# Expose backend port
EXPOSE 8000

# Health check to verify API status
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-8000}/api/health || exit 1

# Start the server
CMD ["node", "src/server.js"]

