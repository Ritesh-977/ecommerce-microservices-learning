FROM node:22-alpine AS build

WORKDIR /app

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

EXPOSE 3003

CMD ["sh", "-c", "node scripts/migrate.mjs && node dist/server.js"]
