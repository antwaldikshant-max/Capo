# Capo website

A responsive website and owner dashboard built with Node.js and browser-native HTML, CSS, and JavaScript. No package install is required. The Node server serves the public site, accepts project inquiries, stores editable site content and inquiries in a private JSON file, protects `/admin` with a password login, and sends email replies through Resend when configured.

## Run locally

Use Node.js 20 or newer.

```powershell
cd path\to\capo
$env:CAPO_SETUP_TOKEN = "a-long-one-time-secret"
node server.mjs
```

Open [http://localhost:3000](http://localhost:3000) for the public site and [http://localhost:3000/admin](http://localhost:3000/admin) for owner setup. On first run, create an owner email and a password with at least 12 characters. Then remove `CAPO_SETUP_TOKEN` from the server environment and restart it. The setup token is only used for first-time account creation.

To generate a random setup token, run:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

If the site has already been started without a setup token, stop the server, set the token, and restart it. The token is never saved in the site database.

## Put it online

The included Dockerfile and Compose file provide a portable single-server deployment. On a Docker host with a persistent disk and an HTTPS reverse proxy:

1. Copy this folder to the host.
2. Create a private `.env` file beside `docker-compose.yml`. Set `CAPO_SETUP_TOKEN` to a freshly generated random value. Add a persistent data directory/volume for `/data` (Compose creates a named volume for this).
3. Build and start with `docker compose up --build -d`.
4. Route your domain to the host's port 3000 through an HTTPS reverse proxy. The production session cookie is marked `Secure`, so owner login requires HTTPS.
5. Visit `https://your-domain/admin`, create the owner account using the one-time token, then remove `CAPO_SETUP_TOKEN` from `.env` and restart with `docker compose up -d`.

The application currently uses a private, file-backed JSON store. Keep `/data` on a persistent disk and make regular private backups. Run one application instance against that file; do not mount the same data file into multiple app replicas. The server does not create TLS certificates itself: use the hosting platform or a reverse proxy that provides HTTPS.

## Connect email replies

Project inquiries are stored in the private dashboard inbox without any email provider. To send client replies from that inbox:

1. Create a Resend account and verify a sending domain/address in Resend.
2. Create a Resend API key with email sending permission.
3. Set `RESEND_API_KEY` to that key and `CAPO_FROM_EMAIL` to the verified sender (for example, `Capo <projects@your-domain.com>`) in the server environment.
4. Restart the app. The dashboard will show email replies as ready. If delivery fails, the reply stays unsent and the dashboard shows the provider error.

Resend setup: [API keys](https://resend.com/api-keys) · [Domains](https://resend.com/domains)

The site does not send inquiry notifications to the owner. New inquiries appear in `/admin`; email is used only when the owner sends a reply from an inquiry.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP port. Defaults to `3000`. |
| `CAPO_HOST` | Docker only | Bind address. Docker Compose sets `0.0.0.0`; local runs default to `127.0.0.1`. |
| `NODE_ENV` | Online deployment | Set to `production` to enable secure session cookies. |
| `CAPO_DATA_DIR` | Online deployment | Persistent private storage directory, such as `/data`. |
| `CAPO_SETUP_TOKEN` | First owner setup only | One-time secret to create the first owner account. Remove it after setup. |
| `RESEND_API_KEY` | To send email replies | Resend API key. Keep it in the server environment only. |
| `CAPO_FROM_EMAIL` | To send email replies | Sender address verified with Resend. |

## Privacy and operations

- The public site returns only visible services, portfolio items, and FAQs. Private inquiry records and owner credentials are available only after owner authentication.
- The owner password is stored as a salted scrypt hash. Session cookies are HTTP-only and SameSite Strict; production cookies also require HTTPS.
- Inquiries and editable website content are stored as plain JSON on the server disk. Protect the host and its backups. Do not place the data directory under the public web folder.
- There is no third-party analytics or tracking code. Resend receives a client email address and the reply text only when the owner sends a reply.
- The site text, service descriptions, portfolio, answers, and any prices can be changed in `/admin`. Add only projects and details you are ready to publish.
- Add your own privacy notice and business contact details before launch if you need them. None were supplied for this site.
