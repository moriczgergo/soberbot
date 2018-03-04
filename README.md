# soberbot
Beautiful and fast code snippets.

## Usage

Example: `/sober moriczgergo/soberbot:index.js:1-8`

Argument seperator: `:`

Arguments:
 * Full repository name - `moriczgergo/soberbot`
 * File path - `index.js`
 * Line margin (optional) - `1-8`

## Setup

Sober uses environment variables to be configured. You can also use a `.env` file, if you prefer to. (filtered in .gitignore)

 * SOBER_ID - Slack client ID
 * SOBER_SECRET - Slack client secret
 * SOBER_PORT - Sober running port
 * SOBER_TOKEN - Slack command verification token
 * SOBER_REDIRECT - OAuth redirect URI
 * SOBER_SENTRY - Sentry DSN for logging (TO-DO: make optional)
 * SOBER_MONGO - Mongo URI (optional, will use JSON file store in `./store/` directory if not present)
