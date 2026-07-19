# Legacy database migrations

This directory preserves the database history that existed before
Release 17B-1B.

## Active migration source

The only active Drizzle migration source is:

`packages/db/drizzle`

It contains one canonical production baseline generated from the
actual PostgreSQL `public` schema and tested on a clean temporary
database.

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
