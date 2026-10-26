# taskflow-server

The reference sync backend for TaskFlow: one Node process and one SQLite file, holding one person's data. Devices running the app connect to it with a URL and a token. It applies every device's changes in one order, with the same domain core as the app (`src/core/`). The design is in [`SYNC-AND-API-DESIGN.md`](../SYNC-AND-API-DESIGN.md).

The app works without it: local-only is the default.

## Deploying on fly.io

You need [`flyctl`](https://fly.io/docs/flyctl/install/) and a fly.io account. Run these from the repository root, because the image is built from the whole repo so it carries the same core as the app.

1. **Create the app.** Pick a name; it becomes `https://<name>.fly.dev`.

   ```
   fly auth login
   fly launch --no-deploy --copy-config --name <name>
   ```

   Say no to databases and other add-ons it offers. It writes your app name into `fly.toml`.

2. **Set your timezone.** Edit `TZ` in `fly.toml` (for example `Australia/Brisbane`). Day boundaries and work hours are computed in it. A device elsewhere still works, but the backend's scheduling wins.

3. **Create the volume** that holds the SQLite file, in the same region as `primary_region`:

   ```
   fly volumes create taskflow_data --size 1 --region lhr
   ```

4. **Deploy**, and make sure exactly one machine runs (the backend is the single writer):

   ```
   fly deploy
   fly scale count 1
   ```

5. **Check it answers:**

   ```
   curl https://<name>.fly.dev/v1/info
   ```

6. **Create a token per device**, each shown once. `--link` also prints a connect link to open on that device, which matters on a phone:

   ```
   fly ssh console -C "taskflow-server token create --name laptop"
   fly ssh console -C "taskflow-server token create --name phone --link"
   ```

7. **Connect each device**: open its link, or in the app go to Settings → Sync backend and enter the URL and token. A device with tasks connecting to an empty backend uploads them; one with nothing downloads the backend's; when both have data the app asks whether to merge, keep the backend's, or keep the device's. Disconnecting (same place) leaves the device a full local copy.

   The app must be served from an origin in `ALLOWED_ORIGINS`; to try a local dev build against the deployed backend, add `http://localhost:5173` there.

**Cost and auto-stop.** `fly.toml` stops the machine when no device is connected and starts it on the next request, which takes a second or two. An open app tab keeps its stream connected, so the machine only stops when nobody is using it. To keep it always on, set `auto_stop_machines = "off"` and `min_machines_running = 1`. Either way it is a small shared CPU with 256 MB and a 1 GB volume; check fly.io's pricing page for current numbers.

**Updating.** Run `fly deploy` again after pulling changes. The app shows a notice when its core version differs from the backend's (see "Version skew" in the design doc), so redeploy when the app changes.

## Running it elsewhere

**Locally**, for development:

```
DATA_DIR=./data TZ=Europe/London ALLOWED_ORIGINS=http://localhost:5173 npm run server
npm run server -- token create --name dev
```

**With Docker**, anywhere:

```
docker build -t taskflow-server .
docker run -d -p 8080:8080 -v taskflow-data:/data -e TZ=Europe/London taskflow-server
docker exec <container> taskflow-server token create --name laptop
```

Anywhere but `localhost` it must be served over HTTPS (put a reverse proxy such as Caddy in front of it), because browsers block an HTTPS page from calling a plain HTTP backend.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TZ` | the host's | Home timezone for day boundaries and work hours. Set it |
| `ALLOWED_ORIGINS` | `https://grge.github.io` | Comma-separated origins the app may be served from |
| `DATA_DIR` | `./data` (`/data` in the image) | Where `taskflow.db` lives |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | Where to listen |
| `HISTORY_LIMIT` | `10000` | Operations kept in the log. Devices further behind reload the full state |
| `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST` | `60`, `300` | Write limit per token: a burst for flushing an offline queue, then a steady rate |
| `PUBLIC_URL` | `https://$FLY_APP_NAME.fly.dev` on fly | The backend's URL, for `token create --link` |
| `APP_URL` | `https://grge.github.io/taskflow-app/` | The app's URL, for `token create --link` |

## Commands

```
taskflow-server [serve]                                   run the backend
taskflow-server token create --name N [--scope read] [--link] [--url URL]
taskflow-server token list
taskflow-server token revoke N                            stops working at once; open streams close within 30s
taskflow-server export > backup.json                      the current data, in the app's export format
```

On fly, prefix any of these with `fly ssh console -C "…"`. The export file imports in the app (Settings → Your data), so it is also a way to leave.

## Backups

fly.io snapshots volumes daily and keeps them for a few days (`fly volumes snapshots list`). For a copy you hold yourself:

```
fly ssh console -C "taskflow-server export" > taskflow-backup.json
```

## Testing

`npm run test:server` runs the protocol conformance suite against this server in-process, plus tests of persistence, pruning, rate limits, revocation, and real sync clients converging through it, including edits made while the server is down. To check another deployment or implementation, run the suite against a **fresh, empty** backend (it adds test data):

```
node tests/conformance/run.mjs --url https://… --token <write token> --read-token <read token> --origin https://grge.github.io
```
