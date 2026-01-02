# Simple production Dockerfile for the Component 2 backend
FROM node:18-alpine AS base

WORKDIR /app

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Copy source
COPY src ./src
# Copy helper scripts (for apply-local-redirect)
COPY k8s/component-2 ./k8s/component-2
# Runtime tools needed by the helper (bash, jq, curl, kubectl)
RUN apk add --no-cache bash jq curl kubectl \
   && chmod +x /app/k8s/component-2/apply-local-redirect.sh

ENV NODE_ENV=production \
    PORT=4000

EXPOSE 4000

CMD ["node", "src/index.js"]
