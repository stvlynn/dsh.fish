FROM node:24-bookworm-slim AS dependencies
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY packages/dsh-cli/package.json packages/dsh-cli/package.json
COPY packages/dsh-plugin-hub/package.json packages/dsh-plugin-hub/package.json
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @dsh-fish/frontend...

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies --chown=node:node /app /app
COPY --chown=node:node frontend/build /app/frontend/build
# Runtime bundles resolve transitive backend dependencies through their original workspace package.
RUN ln -s /app/backend/node_modules /app/frontend/build/node/node_modules
USER node
WORKDIR /app/frontend
EXPOSE 3000
CMD ["node", "--max-old-space-size=640", "build/node/index.js"]
