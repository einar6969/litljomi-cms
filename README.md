# Litljómi CMS Hub

One Litljómi-owned CMS platform (Next.js app over one Supabase project) giving each client site an isolated editing environment. Specification: `docs/architecture.md`. Plan: `docs/plans/2026-11-01-m0-m1.md`.

## Commands

Requires Node 22 and pnpm 11.

- `pnpm install`
- `pnpm lint`, `pnpm typecheck`, `pnpm test`
- `pnpm check:slugs`: no tenant slug literal in core code
- `pnpm harness:test`: execution-state tests
