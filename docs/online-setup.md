# Online play: accounts, ranked matches and bots

The game server (`npm start`) serves the site, the WebSocket rooms, and the account API.

## What players get

- **Accounts:** sign up with a username and password, or **Sign in with Google**. A session cookie keeps you signed in for 30 days.
- **Ranked matches:** pick a time control (5+3, 10+5, 15+10, 30+20) and a draft style (Classic, Secret, Auction or Any) and press *Find a ranked match*.
  - Players are paired by rating. The acceptable gap widens the longer you wait.
  - If nobody turns up within 10 seconds, a **bot account** of similar rating takes the seat.
  - Ranked games use legendaries and trainers on a random map.
- **Elo ratings:** everyone starts at 1200. K is 40 for your first 20 games, then 24 (16 above 2000). The ladder ranks players after 10 ranked games; bot accounts are ranked from the start.
- **Profiles** (`/?u=<name>`): rating, peak, record, a rating-history chart and recent games. **Ladder:** the top 100 on the online page.
- **Time controls:** chess-style clocks. A side's clock runs while it has to decide, and it gets the increment each time it hands the move over (each draft pick, bid, placement or finished turn). Running out of time loses.
- **Private rooms** work as before (unranked); the host can now pick the draft style and an optional time control.
- **Bots:** 30 bot accounts (Easy, Medium, Hard) fill the queue. While nobody is waiting they play ranked games against each other, which keeps their ratings honest. Bots think in worker threads, and games with a human come first.

Hidden information stays on the server: in a Secret draft each player is sent only their own pool and picks until the reveal, and in an Auction nobody is sent the order of the lots to come.

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `DATABASE_URL` | **Needed for accounts on Render.** A Postgres connection string. Without it the server keeps accounts in `DATA_DIR/store.json`, which Render's free plan wipes on every deploy and restart. A free Postgres from [Neon](https://neon.tech) or Supabase works; the server creates its tables (`pcc_users`, `pcc_sessions`, `pcc_games`) itself. |
| `GOOGLE_CLIENT_ID` | Turns on *Sign in with Google* (see below). Without it, only username/password sign-up is offered. |
| `BOT_IDLE_GAMES` | Bot-vs-bot games run while the queue is empty (default 1; 0 = off). |
| `KEEP_AWAKE` | On Render the server requests its own address every 5 minutes so it doesn't go to sleep and the bots keep playing each other (uses the free plan's 750 hours a month, enough for one service). `0` turns this off; it is also off when `BOT_IDLE_GAMES` is 0. On other hosts set `KEEP_AWAKE_URL` to the site's public address. |
| `BOT_FILL_MS` | How long a ranked player waits before a bot takes the seat (default 10000). |
| `BOT_THREADS` | Worker threads for bot moves (default 2). |
| `DATA_DIR` | Where the local JSON store goes without a database (default `.data/`, git-ignored). |

Render's free instances sleep after 15 minutes without visitors, and every deploy, restart or wake-up starts from an empty disk. With `DATABASE_URL` set, accounts and finished games are safe in the database (only games in progress and the queue are lost). Without it, **every account and rating is deleted each time**.

To check what the live server is using, open `/health`: it shows `"storage":"postgres"` or `"storage":"file"`.

### Setting up the database (once, about 5 minutes)

1. Create a free project at [neon.tech](https://neon.tech) and copy its connection string (`postgresql://…?sslmode=require`).
2. In the Render dashboard: the service → **Environment** → add `DATABASE_URL` with that string → **Save, rebuild, and deploy**.
3. Open `/health` and check that it says `"storage":"postgres"`. Accounts made from then on survive deploys.

## Setting up Sign in with Google

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials), create a project, configure the OAuth consent screen (External, app name, your email), then **Create credentials → OAuth client ID → Web application**.
2. Under **Authorized JavaScript origins** add your site, e.g. `https://pokemon-conquest-chess.onrender.com` (and `http://localhost:5173` for development).
3. Copy the client ID (`….apps.googleusercontent.com`) into the `GOOGLE_CLIENT_ID` environment variable on Render and redeploy.

The server checks each Google sign-in token with Google and only accepts tokens issued for that client ID. A new Google sign-in gets a username made from the Google name, which the player can change from the account menu.

## Development

`npm run dev` (the site) and `npm run server` (the game server) in two terminals; Vite forwards `/ws` and `/api` to the server.
