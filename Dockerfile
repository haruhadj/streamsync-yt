# Use Node.js 20 as the base image
FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app

# --- Build Stage ---
FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN npx prisma generate
RUN pnpm run build

# --- Runner Stage ---
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# Install production dependencies only
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy built frontend and necessary backend files
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Expose the port
EXPOSE 3000

# Run the server using tsx
CMD ["npx", "tsx", "server.ts"]
