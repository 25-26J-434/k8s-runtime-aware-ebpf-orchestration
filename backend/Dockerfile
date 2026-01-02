# Simple production Dockerfile for the Component 2 backend
FROM node:18-alpine AS base

WORKDIR /app

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy source
COPY src ./src

# Copy helper script from root
COPY apply-local-redirect.sh ./apply-local-redirect.sh

# Runtime tools needed by the helper
RUN apk add --no-cache bash jq curl kubectl \
    && chmod +x /app/apply-local-redirect.sh

ENV NODE_ENV=production \
    PORT=4000

EXPOSE 4000

CMD ["node", "src/index.js"]