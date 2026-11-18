#!/bin/sh
# Minimal PostgreSQL 18 client tools for local backups; requires a C toolchain.
# For remote TLS databases, use distro-managed PostgreSQL clients via PG_BIN_DIR.
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
client_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/blocksonar-pg-client.XXXXXX")
trap 'rm -rf "$client_build_dir"' EXIT HUP INT TERM
curl --fail --location --silent --show-error https://ftp.postgresql.org/pub/source/v18.7/postgresql-18.7.tar.bz2 --output "$client_build_dir/source.tar.bz2"
node --input-type=module - "$client_build_dir/source.tar.bz2" <<'JS'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
if (createHash('sha256').update(readFileSync(process.argv[2])).digest('hex') !== '441dfae4280cae3e0425e5f876f80559fb0731c140f1aae22b3e5a54d0411bfd') throw new Error('PostgreSQL source checksum mismatch')
JS
tar -xjf "$client_build_dir/source.tar.bz2" -C "$client_build_dir"
cd "$client_build_dir/postgresql-18.7"
./configure --prefix="$project_dir/.tools/postgresql" --without-icu --without-readline --without-zlib --without-lz4 --without-zstd
make -C src/backend generated-headers
make -C src/port
make -C src/common
make -C src/interfaces/libpq
make -C src/bin/pg_dump
make -C src/interfaces/libpq install
make -C src/bin/pg_dump install
"$project_dir/.tools/postgresql/bin/pg_dump" --version
