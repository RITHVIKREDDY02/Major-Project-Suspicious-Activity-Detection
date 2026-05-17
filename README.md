# Suspicious Activity Detection (SAR)

A B.Tech major project at Matrusri Institute of Engineering and Technology that
automates CCTV surveillance monitoring using YOLOv5-based object detection to
identify suspicious activities (theft, loitering, vandalism, fighting,
trespassing, fire, weapons, etc.).

## Stack

- **Frontend**: React + Vite + Tailwind + shadcn/ui (dark navy + amber surveillance theme)
- **Backend**: Express 5 (Node 24, TypeScript)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod
- **Monorepo**: pnpm workspaces

## Project layout

```
artifacts/
  sar-detection/    # React + Vite frontend
  api-server/       # Express backend
lib/
  db/               # Drizzle schema, migrations, client
  api-spec/         # OpenAPI spec
  api-zod/          # Generated Zod schemas
  api-client-react/ # Generated React Query hooks
```

## Local development

```bash
pnpm install
pnpm --filter @workspace/db run push      # create tables in your local PG
pnpm --filter @workspace/api-server dev   # start API on PORT
pnpm --filter @workspace/sar-detection dev # start frontend on PORT
```

## Production deployment (EC2)

See [`DEPLOY.md`](./DEPLOY.md) for the full step-by-step EC2 + Docker Compose guide.

Quick version on a fresh Ubuntu EC2 instance:

```bash
git clone https://github.com/RITHVIKREDDY02/Suspicious-Activity-Detection.git
cd Suspicious-Activity-Detection
cp .env.example .env && nano .env   # set POSTGRES_PASSWORD and SESSION_SECRET
docker compose up -d --build
pnpm install && pnpm --filter @workspace/db run push   # create DB tables
```

App is then available at `http://<EC2_PUBLIC_IP>`.

## Database tables

| Table | Purpose |
|---|---|
| `users` | Account credentials & profile |
| `detections` | Each uploaded image/video detection result with bounding boxes |
| `monitors` | Live camera monitor configurations |

Inspect on the server:

```bash
docker compose exec db psql -U sar -d sardb -c '\dt'
```
