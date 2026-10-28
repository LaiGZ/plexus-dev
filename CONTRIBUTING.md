# Contributing

Thanks for taking a look. plexus is intentionally small; the fastest way to get a change
merged is to keep it that way.

## Setup

```bash
pnpm install
pnpm dev            # contracts build + API :3000 + web :5566
```

The first API start prints a generated admin password. Use
`PLEXUS_ADMIN_PASSWORD=dev-password-123` for a stable local password.

The assistant uses `MODEL_PROVIDER=stub` when no key is configured, so you can exercise the
whole loop offline.

## Before opening a PR

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same commands plus an end-to-end smoke test (`scripts/smoke.mjs`) and a Docker
build. A PR that skips tests on new behaviour will be asked for them.

## Conventions

- **One error envelope.** Throw `AppError` from `infra/errors.ts`; never return ad-hoc shapes.
- **No `process.env` outside `config.ts`.** ESLint enforces it; add the variable to the zod
  schema and to `.env.example`.
- **Contracts live in `packages/contracts`.** Request/response shapes are zod schemas; the web
  app derives its types from them. Do not hand-write a second DTO.
- **Every tool call goes through `invokeTool()`.** Auth, egress, idempotency and logging must
  not be bypassed, including for internal features.
- **Migrations are files.** Change `schema.ts`, run `pnpm db:generate`, commit the SQL.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`).

## What we will probably decline

- Multi-tenancy, orgs, RBAC, SSO.
- A background job queue or a second datastore for a single-user tool.
- Features that only work when an external SaaS is configured.

If a proposal needs one of those, open an issue first and make the case.

## Reporting bugs

Include: version (`/healthz`), reproduction steps, and the `requestId` from the error or
log line. Redact tokens and upstream credentials.
