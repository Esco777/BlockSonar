FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_MEMBERSHIP_CONTRACT_ADDRESS
ARG VITE_MEMBERSHIP_CHAIN_ID
# Default to the existing public Sepolia deployment when both arguments are empty.
RUN if [ -z "$VITE_MEMBERSHIP_CONTRACT_ADDRESS" ] && [ -z "$VITE_MEMBERSHIP_CHAIN_ID" ]; then \
      export VITE_MEMBERSHIP_CONTRACT_ADDRESS=0x0742126033F9697EFb7B434871E817Af3982F32D \
        VITE_MEMBERSHIP_CHAIN_ID=11155111; \
    fi; \
    npm run build:production
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4001
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/migrations ./server/migrations
COPY --from=build --chown=node:node /app/scripts/start-production.mjs ./scripts/start-production.mjs
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "scripts/start-production.mjs"]
