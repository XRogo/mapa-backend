# mapa-backend

The backend exposes the polygon history to the Craftly map and appends polygon changes as new JavaScript files under `poligons/`.

## Required environment variables

- `GITHUB_TOKEN` — token allowed to read and update the map repository.
- `REPO_OWNER` — GitHub owner of the map repository.
- `REPO_NAME` — map repository name.
- `SAVE_PASSWORD` — password required by the save endpoint.
- `PORT` — optional port (defaults to `3000`).

## Endpoints

- `GET /status` — service health.
- `GET /polygon-history` — timestamped polygon-history filenames, oldest first.
- `POST /save-batch` — appends polygon operations to a new timestamped file and rejects stale base versions; the render-selection list retains its existing update behavior.
- `GET /get-render-list` — reads the render-selection list.

History files use `HH.mm.dd.MM.yyyy.js` in the Europe/Warsaw time zone. If a save happens more than once in a minute, a numeric suffix is added to prevent overwriting an existing version.
