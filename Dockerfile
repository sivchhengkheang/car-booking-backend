# ==========================================
# Backend Dockerfile for Car Booking API
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install wget for healthcheck if needed
RUN apk add --no-cache wget

# Set environment
ENV NODE_ENV=production
ENV PORT=5000

# Copy package manifests first for caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev --ignore-scripts

# Copy application source code
COPY src ./src
COPY uploads ./uploads

# Ensure uploads folder exists and has proper permissions
RUN mkdir -p /app/uploads && chown -R node:node /app

# Switch to non-root user
USER node

# Expose backend port
EXPOSE 5000

# Healthcheck to ensure API responsiveness
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/v1/health || exit 1

# Start the server
CMD ["node", "src/server.js"]
