# Janbao

A small forum app for Janbao.

## Development

```sh
bun install
cp .env.example .env
bun run dev
```

Common checks:

```sh
bun run check
bun run lint
bun run build
```

Local development uses `.local.db`. Database migrations in `drizzle/local-migrations/`
are applied automatically when the app starts.

## Media storage

Avatars and attachments use pCloud by default. Set `MEDIA_STORAGE_PROVIDER=s3`
to use any S3-compatible service with AWS Signature Version 4:

```dotenv
MEDIA_STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.us-east-1.amazonaws.com
S3_BUCKET=example-bucket
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_REGION=us-east-1
S3_SESSION_TOKEN=
S3_FORCE_PATH_STYLE=false
S3_PREFIX=Janbao
S3_CDN_BASE_URL=https://cdn.example.com
```

`S3_SESSION_TOKEN` is only required for temporary credentials.
`S3_FORCE_PATH_STYLE` defaults to `true`; set it to `false` for virtual-hosted-style
endpoints. `S3_PREFIX` and `S3_CDN_BASE_URL` are optional. Without a CDN URL, the
application reads private objects through signed S3 requests and streams them to clients.
Avatars are stored at `<prefix>/avatars/<userId>` and replaced on update, matching
the existing pCloud layout. Application URLs retain `/avatar/<userId>/<sha>.<ext>`.
Direct S3/CDN object responses require cache revalidation; configure the CDN to honor
origin cache headers. Proxied application responses retain their existing cache policy.
Avatar routes proxy and verify the stored bytes against the requested SHA, even when
a CDN is configured. Pending uploads are hidden and concurrent uploads are rejected.
An interrupted process can leave a publication lock: stop avatar writers before
reconciling the fixed object and database metadata; do not clear a lock while its
writer may still be running. Cleanup failures log the object path, and failed
restorations log the avatar and retained backup paths. Configure storage lifecycle
cleanup for abandoned `tmp/` uploads with enough retention for manual recovery;
pCloud temporary objects need equivalent scheduled cleanup.
Attachments use `<prefix>/attachments/<sha>` and retain immutable caching.
`S3_ENDPOINT` must be the service-level endpoint without the bucket name; the application
adds `S3_BUCKET` according to the selected addressing style.

Provider selection has no cross-provider fallback. When changing an existing deployment,
all referenced media objects must already exist in the newly selected provider. This
project does not migrate old media automatically.

## Docker

Create the runtime env file first:

```sh
cp .env.docker.example .env.docker
```

Set `JWT_SECRET` in `.env.docker` before the first boot:

```sh
openssl rand -hex 32
```

Run with compose:

```sh
docker compose up --build
```

The app listens on <http://localhost:3000>. The SQLite database is stored at
`./data/janbao.db`.

Build the image manually:

```sh
docker build -t janbao:local .
```

Run the image manually:

```sh
mkdir -p data
docker run --rm \
  --env-file .env.docker \
  -p 3000:3000 \
  -v "$PWD/data:/data" \
  janbao:local
```

To reuse a local database:

```sh
mkdir -p data
cp .local.db data/janbao.db
docker compose up --build
```

## Published Docker images

GitHub Actions publishes images to GitHub Container Registry:

```sh
docker pull ghcr.io/<owner>/<repo>:latest
```

Published tags:

- `latest` for pushes to `master`
- `master` for pushes to `master`
- `v1.0.0` style tags for version releases
- `sha-<commit>` for pinned deployments

To publish a version:

```sh
git tag v1.0.0
git push origin v1.0.0
```

## Server operations

The bare-metal Bun deployment can install `scripts/janbaoctl` as
`/usr/local/sbin/janbaoctl`. Run it as root:

```sh
janbaoctl status
janbaoctl backup
janbaoctl stop
janbaoctl start
janbaoctl restart
janbaoctl deploy                   # origin/master
janbaoctl deploy <commit-or-tag>
janbaoctl rollback <commit-or-tag>
janbaoctl rollback <commit-or-tag> <database-backup>
janbaoctl backups
janbaoctl restore <database-backup>
```

Deployments create a verified SQLite snapshot before changing revisions. Local snapshots
are stored in `/var/backups/janbao`, with the newest 14 retained by default. They contain
the database only; media objects require a separate backup. Configuration paths and
retention can be overridden with the `JANBAO_*`
environment variables declared at the top of the script.

## Data import

Configure the selected media provider first. For pCloud, the setup helper can create
the required folders:

```sh
bun scripts/setup-pcloud.ts
```

Import a crawled Vanilla Forums export:

```sh
bun scripts/import-data.ts <path-to-data-directory>
```

Run the import on the host machine, not inside the Docker image. The import script
expects `cwebp` and `gif2webp` to be available on `PATH`.
