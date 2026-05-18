FROM node:20

RUN npm install -g pnpm@10

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

ENV BASE_PATH=/
ENV PORT=3000
ENV NODE_ENV=production

RUN pnpm --filter @workspace/sar-detection run build
RUN pnpm --filter @workspace/api-server run build

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
