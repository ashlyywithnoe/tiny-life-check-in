# Tiny Life Check-In — Cloudflare Worker

Hosted version of the Tiny Life Check-In Discord bot.

## What it does

- Posts to the configured Discord channel at 12 PM and 8 PM America/New_York.
- Uses an hourly Cloudflare Cron Trigger and checks Eastern local time, so DST is handled automatically.
- Keeps the `/tiny` and `/tinystatus` Discord slash commands through Discord's HTTP Interactions Endpoint.
- Adds `https://win-of-the-day.pages.dev/` under every check-in.
- Tries to resolve your configured custom Discord emoji names from the server.
- Does not require an always-on PC or a Discord Gateway connection.

## Cloudflare variables

Already in `wrangler.jsonc`:

- `GUILD_ID=1523898722973388942`
- `TARGET_CHANNEL_ID=1523898724034674812`
- `SITE_URL=https://win-of-the-day.pages.dev/`
- `EMOJI_NAMES=kibrytroll,pixel_uwu`

Add these in Cloudflare Worker Settings > Variables and Secrets after the first deploy:

- `DISCORD_TOKEN` — **Secret**. Your bot token. Never commit it to GitHub.
- `DISCORD_PUBLIC_KEY` — Variable or Secret. Found in Discord Developer Portal > General Information > Public Key.

Optional:

- `PING_USER_ID` — a Discord user ID if you want scheduled posts to ping somebody.

## Discord Interactions Endpoint

After deploying and adding the variables, open Discord Developer Portal > your Tiny Life application > General Information and set **Interactions Endpoint URL** to the Worker's public URL (either the root URL or `/discord`). Discord will validate the endpoint with a signed PING.

The existing `/tiny` and `/tinystatus` commands that were registered by the original Python bot can continue to be used. If you delete those commands later, you will need to register them again through Discord's application-command API.

## Important

Once this Worker is live, stop the old Python bot on your PC. Otherwise the Python scheduler and Cloudflare scheduler can both send the same day's check-ins.
