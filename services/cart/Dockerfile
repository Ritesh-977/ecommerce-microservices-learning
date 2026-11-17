FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies (service is standalone in this image; workspace deps are not required).
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts ./scripts

EXPOSE 3002

# Apply SQL migrations at startup, then run the service.
CMD ["sh", "-c", "node scripts/migrate.mjs && node dist/server.js"]
