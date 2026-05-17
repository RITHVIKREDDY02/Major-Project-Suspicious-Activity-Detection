FROM node:20

  RUN npm install -g pnpm@10

  WORKDIR /app

  # Copy workspace manifest and lock file first — this layer is cached
  # as long as dependencies don't change, even when source code changes.
  COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

  # Copy all package.json files from every workspace so pnpm can resolve
  # the workspace graph before any source files are copied.
  COPY lib/db/package.json lib/db/
  COPY lib/api-zod/package.json lib/api-zod/
  COPY lib/api-client/package.json lib/api-client/
  COPY lib/api-client-react/package.json lib/api-client-react/
  COPY artifacts/api-server/package.json artifacts/api-server/
  COPY artifacts/sar-detection/package.json artifacts/sar-detection/

  RUN pnpm install --frozen-lockfile

  # NOW copy all source files — changes here only invalidate the build steps,
  # not the expensive install step above.
  COPY . .

  ENV BASE_PATH=/
  ENV PORT=3000
  ENV NODE_ENV=production

  RUN pnpm --filter @workspace/sar-detection run build
  RUN pnpm --filter @workspace/api-server run build

  COPY entrypoint.sh ./
  RUN chmod +x entrypoint.sh

  EXPOSE 3000

  ENTRYPOINT ["./entrypoint.sh"]
  