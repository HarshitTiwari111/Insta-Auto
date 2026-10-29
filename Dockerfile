# API and worker share this image; the start command picks the process:
#   API:    npm run start:api
#   Worker: npm run start:worker
# The PWA (apps/web) is deployed separately (Vercel), see DEPLOY.md.
FROM node:22-bookworm-slim

# Prisma needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# Install with the workspace manifests first so this layer is cached between code changes
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
# postinstall runs `prisma generate`
RUN npm ci --include=dev

COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker

EXPOSE 4000
CMD ["npm", "run", "start:api"]
