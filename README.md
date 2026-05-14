# kiro-node

Kiro IDE reverse proxy with Anthropic-compatible endpoints and a built-in admin console.

## Quick Start

The fastest server deployment is:

```bash
git clone https://github.com/WindSnow-1/Kiro-wa.git kiro-node
cd kiro-node
docker compose up -d --build
```

Then open:

```text
http://YOUR_SERVER_IP:8990/admin
```

Default keys:

- Admin console key: `sk-admin`
- Proxy API key: `sk-kiro-node`

Add Kiro credentials from the admin console.

For public servers, change the keys with environment variables:

```bash
API_KEY=your-api-key ADMIN_API_KEY=your-admin-key docker compose up -d --build
```

## Local Setup

```bash
npm install
npm start
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
