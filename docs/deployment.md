# Deploying the live demo

The hosted demo is three free services:

| Part | Host | Config in this repo |
| --- | --- | --- |
| Postgres | [Neon](https://neon.tech) | none (created in the dashboard) |
| API (Fastify) | [Render](https://render.com) | `render.yaml` |
| Web (Next.js) | [Vercel](https://vercel.com) | `apps/web/vercel.json` |

With `SIMULATION_ENABLED=true` the API writes its own data every minute, so
nothing needs seeding. Its start command runs the migrations and
`bootstrap` (services, metrics and alert rules, never deletes anything),
then starts the server, which fills in the last 24 hours on first boot.

Order matters a little: the API needs the database URL, the web app needs
the API URL, and the API's CORS setting needs the web app's URL.

## 1. Database (Neon)

1. Create a project. Pick a region near the API (Frankfurt if you keep
   `region: frankfurt` in `render.yaml`).
2. Copy the connection string. Use the **direct** one rather than the
   pooled one, and keep `?sslmode=require` at the end.

## 2. API (Render)

1. **New > Blueprint**, connect the GitHub repository, and select
   `render.yaml`.
2. Fill in the two variables it asks for:
   - `DATABASE_URL`: the Neon connection string.
   - `WEB_ORIGIN`: for now, `https://example.com`. You will set the real
     value in step 4, once Vercel has given you a URL.
3. Deploy, then open `https://<your-service>.onrender.com/api/ping`. It
   should answer with `"message":"opslens api is up"`. The deploy log should include
   `Bootstrap: 4 services, 8 metrics, 8 new alert rules.` and, shortly
   after start, `simulation caught up`.

## 3. Web (Vercel)

1. **Add New > Project**, import the repository.
2. Set **Root Directory** to `apps/web`. The install and build commands
   come from `apps/web/vercel.json`.
3. Add two environment variables, both set to the Render URL with no
   trailing slash (for example `https://opslens-api.onrender.com`):
   - `NEXT_PUBLIC_OPSLENS_API_URL`, used by the browser.
   - `OPSLENS_API_URL`, used by server rendering.
4. Deploy. `NEXT_PUBLIC_` values are baked in at build time, so changing
   them later needs a redeploy.

## 4. Connect the two

In Render, set `WEB_ORIGIN` to the Vercel production URL (for example
`https://opslens.vercel.app`, no trailing slash) and redeploy. It is the
only origin the API accepts, for normal requests and for the live SSE
stream.

## 5. Optional: keep the API awake

Render's free tier stops the API after about 15 idle minutes, and the
next visitor waits while it starts (often around a minute). Nothing is
lost while it sleeps: on start it writes the minutes it missed and
replays the alert evaluator over any incident in that gap.

To avoid the wait, set the repository variable `DEMO_API_URL` to the
Render URL (GitHub: **Settings > Secrets and variables > Actions >
Variables**). `.github/workflows/keep-demo-awake.yml` then pings the API
every 10 minutes. Check Render's current free-tier terms before relying
on this.

## What visitors will see

Times are UTC. Every 3 hours (00:00, 03:00, 06:00, ...) one service, in
rotation, has an incident:

| Minute into the period | What happens |
| --- | --- |
| -0:20 | the new release reaches staging, which stays healthy |
| 0:40 | the release ships to production |
| 0:44 | error rate and p95 latency spike |
| about 0:47 and 0:49 | the error-rate and latency alerts fire (180 s and 300 s rules) |
| 0:57 | rollback to the previous release |
| 0:59 | metrics recover; both alerts resolve on the next evaluation |
| 1:50 | a different service ships a healthy release |

Outside those windows the fleet overview shows no active alerts. The
**Alerts** page always has the recent incidents: open one and use
**Open the metric chart**.

## Troubleshooting

- **The page says it could not load data, with a Retry button.** The API
  was probably asleep. Retry after a minute.
- **Browser console shows CORS errors.** `WEB_ORIGIN` on Render does not
  exactly match the address in the browser bar (scheme, no trailing
  slash). Preview deployments have different URLs and are not allowed.
- **Requests go to `localhost:4000`.** `NEXT_PUBLIC_OPSLENS_API_URL` was
  missing when Vercel built the app. Set it and redeploy.
