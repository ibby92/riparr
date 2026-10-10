#!/usr/bin/env bash
# Builds a release image locally: lint, typecheck and the full test suite (including
# the 7-Zip tests, run inside the build stage), then tags riparr:<version> and riparr:latest.
#   npm run release            # version from package.json
#   npm run release -- 1.2.0   # explicit version
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-$(node -p "require('./package.json').version")}"
echo "==> Riparr $version"

echo "==> Lint, typecheck, unit tests"
npm run lint
npm run typecheck
npm test

echo "==> Full test suite with 7-Zip (in the build stage)"
docker build -q --target build -t riparr:build-test . >/dev/null
docker run --rm riparr:build-test sh -c "
  sed -i 's/^Components: main\$/Components: main non-free/' /etc/apt/sources.list.d/debian.sources &&
  apt-get update -qq >/dev/null && apt-get install -y -qq p7zip-full p7zip-rar rar >/dev/null 2>&1 &&
  npx vitest run"
docker rmi riparr:build-test >/dev/null

echo "==> Image"
docker build -t "riparr:$version" -t riparr:latest .
echo "==> Built riparr:$version (also tagged riparr:latest)"
echo "    Deploy: docker compose up -d   |   Roll back: docker tag riparr:<previous> riparr:latest && docker compose up -d"
