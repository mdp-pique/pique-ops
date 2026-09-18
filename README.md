# Pique Ops

Internal ticketing & conversations platform for Pique Properties — the first phase of the Pique ops platform. Full spec in [`docs/PRD.md`](./docs/PRD.md); working conventions and schema notes for Claude Code in [`CLAUDE.md`](./CLAUDE.md).

## Stack

- [Next.js](https://nextjs.org) (App Router, TypeScript, Tailwind CSS)
- [Supabase](https://supabase.com) (Postgres, Auth, Storage)
- Deployed on Vercel

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase + integration credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database

Migrations live in `supabase/migrations/` and are applied via the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):

```bash
npx supabase link --project-ref fnapzaunhfjqftvbduma
npx supabase db push
```

This app shares a production Supabase project with other internal tools — see `CLAUDE.md` for schema conventions and known overlap to check before adding tables.
