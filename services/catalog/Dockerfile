FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies (service is standalone in this image; workspace deps are not required).
COPY package.json ./
RUN npm install --ignore-scripts --no-audit --no-fund

# Generate Prisma client and compile TypeScript.
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

EXPOSE 3001

# Apply committed migrations at startup, then run the service.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
