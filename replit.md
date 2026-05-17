# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Session**: cookie-session

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

### sar-detection (React + Vite frontend)
- Preview path: `/`
- Pages: Home (`/`), Login (`/login`), Register (`/register`), Dashboard (`/dashboard`), Upload (`/upload`), Detections list (`/detections`), Detection detail (`/detections/:id`)
- Styled as a professional surveillance command center (dark navy + amber/orange)

### api-server (Express backend)
- Preview path: `/api`
- Routes: `/api/auth/*`, `/api/detections/*`, `/api/stats/*`, `/api/healthz`
- Session: cookie-session with SESSION_SECRET env var
- Auth: SHA-256 password hashing with session storage

## Database Schema

- **users**: id, username, email, fullName, passwordHash, createdAt, updatedAt
- **detections**: id, userId, inputType, inputUrl, inputFilename, activityType, confidence, status, boundingBoxes (JSON string), processedImageUrl, notes, createdAt, updatedAt

## Project Description

Suspicious Activity Detection (SAR) web application based on YOLOv5 object detection, built as a B.Tech major project by students at Sreyas Institute of Engineering and Technology. Automates CCTV surveillance monitoring to detect suspicious activities (theft, loitering, vandalism, fighting, trespassing, etc.) using AI/ML object detection algorithms.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
