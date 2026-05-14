# kiro-node

Kiro IDE reverse proxy with Anthropic-compatible endpoints and a built-in admin console.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create local config files from the examples:

   ```bash
   cp config/config.example.json config/config.json
   cp config/credentials.example.json config/credentials.json
   ```

3. Edit the local files with your own API keys and Kiro credentials.

4. Start the server:

   ```bash
   npm start
   ```

5. Open the admin console:

   ```text
   http://127.0.0.1:8990/admin
   ```

## Endpoints

- `GET /v1/models`
- `POST /v1/messages`
- `POST /cc/v1/messages`
- `GET /admin`

## Security

Local credential files are intentionally ignored by git:

- `config/config.json`
- `config/credentials.json`

Only `*.example.json` files should be committed.
