# ARU IT Ticketing V5.5.1 Patch

## Root-only permanent ticket deletion

- Root Administrator can permanently delete any ticket from Ticket Detail.
- Administrator and Supervisor cannot delete tickets.
- Deletion uses an in-app danger confirmation and requires typing the exact ticket ID.
- Deleted tickets disappear from monitoring, analytics, and Excel reports.
- Evidence files referenced by the deleted ticket are also removed from `uploads/tickets` / `uploads/resolutions` when present.
- Root can delete regardless of PIC assignment or IT/Network routing.
- Valid completed work should normally remain auditable and be closed using Resolve; permanent deletion is intended for duplicate, wrong-input, test/demo, or invalid records.

## Production binding cleanup

`server.js` now uses `HOST` with a safe default of `127.0.0.1`. This means production no longer needs a local-only edit to `app.listen(...)`, so future `git pull --ff-only` deployments can remain clean.

No SQL migration and no new dependency are required.
