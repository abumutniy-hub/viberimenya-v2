# Legacy database migrations

This directory preserves the database history that existed before
Release 17B-1B.

## Active migration source

The only active Drizzle migration source is:

`packages/db/drizzle`

It contains the canonical production baseline followed by reviewed,
versioned Event Core and Payment Core migrations. Every new migration
is tested on a temporary copy of the production database before it is
applied to production.

## Preserved history

- `legacy-applied/manual` contains the manually executed SQL files
  that previously lived in `packages/db/migrations`.
- `legacy-applied/drizzle-before-17b1b` contains the original
  `0000_salty_thena` Drizzle baseline and its old metadata.

These files are historical references only. They must not be applied
to production again.

## Production rule

`db:push` is blocked. All future database changes must be created as
versioned Drizzle SQL migrations, tested against a temporary database,
backed up, and then applied through a reviewed release.
