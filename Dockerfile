# policy platform — web app + migrations, one container.
# Build: monorepo pnpm install → next build (standalone output).
# Run:   apply migrations, then start the standalone server.

FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @policy/web build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/packages/db/migrations ./migrations
# The migrator gets its own vendored pg — independent of Next's dependency
# tracing (ESM resolution is file-location based, so the script sits beside
# its node_modules).
RUN cd /app && mkdir migrate-deps && cd migrate-deps \
  && npm init -y >/dev/null && npm install --no-audit --no-fund pg@8 >/dev/null
COPY --from=builder /app/packages/db/scripts/migrate.ts ./migrate-deps/migrate.ts
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/migrations
CMD ["sh", "-c", "node --experimental-strip-types /app/migrate-deps/migrate.ts && exec node apps/web/server.js"]
