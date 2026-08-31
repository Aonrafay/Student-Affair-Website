FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies first (better layer caching).
COPY server/package*.json ./
RUN npm install --omit=dev

# Application code.
COPY server ./server
COPY public ./public
COPY admin ./admin
COPY uploads ./uploads

RUN mkdir -p /app/uploads

EXPOSE 5000

# Migrate + seed (idempotent) then start serving.
CMD ["sh", "-c", "node server/scripts/migrate.js && node server/scripts/seed.js && node server/index.js"]