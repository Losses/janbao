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

## Data import

Configure pCloud credentials first:

```sh
bun scripts/setup-pcloud.ts
```

Import a crawled Vanilla Forums export:

```sh
bun scripts/import-data.ts <path-to-data-directory>
```

Run the import on the host machine, not inside the Docker image. The import script
expects `cwebp` and `gif2webp` to be available on `PATH`.
