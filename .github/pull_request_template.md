## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## How to verify

<!-- Commands or steps a reviewer can run. -->

## Checklist

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass
- [ ] New behaviour has a test (or a reason it cannot)
- [ ] If a tool call path changed, it still goes through `invokeTool()`
- [ ] If config/env changed, `.env.example` and the README table were updated
- [ ] If the schema changed, the generated migration is committed
- [ ] No secrets, tokens, or private URLs in the diff
