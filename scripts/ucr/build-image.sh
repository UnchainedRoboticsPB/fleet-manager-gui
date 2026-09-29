#!/usr/bin/env bash
#
# Build and publish the branded Grafana image.
#
# This fork ships a handful of frontend changes on top of upstream Grafana and
# is rebuilt a few times a year, so there is no CI for it: enabling Actions here
# would also enable the ~89 upstream Grafana workflows, which reference runner
# labels and secrets this organisation does not have.
#
# What CI would have given us is provenance — being able to answer "which
# Grafana is this panel running?" from the image alone. That is why the version
# is explicit, the commit is stamped into the image, and a dirty worktree is
# refused: an image that claims a commit it was not built from is worse than no
# answer at all.
#
# Build on x86_64 Linux. The Dockerfile pins its JavaScript stage to
# linux/amd64 (`ARG JS_PLATFORM`), so on Apple Silicon the heaviest stage — an
# 8 GB webpack build — runs under QEMU.
#
# Usage:
#   scripts/ucr/build-image.sh 1              # build 13.0.0-ucr.1 locally
#   scripts/ucr/build-image.sh 1 --push       # ... and publish it
#   scripts/ucr/build-image.sh 1 --push --latest
#
set -euo pipefail

REGISTRY="${REGISTRY:-rg.fr-par.scw.cloud/ucr-products-registery}"
IMAGE="${IMAGE:-fleet-manager-gui}"

repo_root() { cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd; }
die() { printf '\n  %s\n\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

usage() {
  sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

BUILD_NUMBER=""
PUSH=false
TAG_LATEST=false
ALLOW_DIRTY=false

while [ $# -gt 0 ]; do
  case "$1" in
    --push)        PUSH=true ;;
    --latest)      TAG_LATEST=true ;;
    --allow-dirty) ALLOW_DIRTY=true ;;
    -h|--help)     usage 0 ;;
    -*)            die "Unknown option: $1" ;;
    *)
      [ -n "$BUILD_NUMBER" ] && die "Give exactly one build number."
      BUILD_NUMBER="$1"
      ;;
  esac
  shift
done

[ -n "$BUILD_NUMBER" ] || usage 1
[[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || die "Build number must be a positive integer, got: $BUILD_NUMBER"

cd "$(repo_root)"

# ── preconditions ───────────────────────────────────────────────────────────
command -v docker >/dev/null || die "docker is not on PATH."

ARCH="$(uname -m)"
if [ "$ARCH" != "x86_64" ]; then
  note "WARNING: building on $ARCH, not x86_64."
  note "The JavaScript stage is pinned to linux/amd64 and will run under"
  note "emulation. Expect this to take hours rather than tens of minutes."
  note ""
fi

if [ "$ALLOW_DIRTY" = false ] && [ -n "$(git status --porcelain)" ]; then
  die "Worktree is dirty. The image stamps the current commit, so it would
  claim code that is not in it. Commit, stash, or pass --allow-dirty if you
  are only testing the build and will not push it."
fi

if [ "$PUSH" = true ] && [ "$ALLOW_DIRTY" = true ]; then
  die "Refusing --push with --allow-dirty: a published image must correspond
  to a commit somebody else can check out."
fi

# ── version ─────────────────────────────────────────────────────────────────
# Derived from Grafana's own package.json rather than kept in a second place,
# so the tag always names the Grafana that is actually inside the image.
GRAFANA_VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[ -n "$GRAFANA_VERSION" ] || die "Could not read the Grafana version from package.json."

# 13.0.0-pre -> 13.0.0; upstream's pre-release suffix is noise in our tag, and
# the exact value is kept as a label below.
GRAFANA_BASE="${GRAFANA_VERSION%%-*}"
VERSION="${GRAFANA_BASE}-ucr.${BUILD_NUMBER}"

COMMIT_SHA="$(git rev-parse HEAD)"
BUILD_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

TAGS=(--tag "${REGISTRY}/${IMAGE}:${VERSION}")
[ "$TAG_LATEST" = true ] && TAGS+=(--tag "${REGISTRY}/${IMAGE}:latest")

note ""
note "image    ${REGISTRY}/${IMAGE}:${VERSION}"
[ "$TAG_LATEST" = true ] && note "         ${REGISTRY}/${IMAGE}:latest"
note "grafana  ${GRAFANA_VERSION}"
note "commit   ${COMMIT_SHA} (${BUILD_BRANCH})"
note "push     ${PUSH}"
note ""

# Checked by reading the credential store rather than by attempting a login:
# a probe with throwaway credentials is a failed auth against someone else's
# registry, and it would be logged as one.
if [ "$PUSH" = true ] && ! grep -q "${REGISTRY%%/*}" "${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null; then
  die "No credentials found for ${REGISTRY%%/*}.
  Run 'docker login ${REGISTRY%%/*}' first — better to stop now than after a
  build that takes tens of minutes."
fi

# ── build ───────────────────────────────────────────────────────────────────
# COMMIT_SHA and BUILD_BRANCH are Grafana's own build args: it surfaces them in
# the UI footer and on /api/health, which is what makes a running panel
# self-identifying.
docker build \
  --platform linux/amd64 \
  --build-arg "COMMIT_SHA=${COMMIT_SHA}" \
  --build-arg "BUILD_BRANCH=${BUILD_BRANCH}" \
  --label "org.opencontainers.image.version=${VERSION}" \
  --label "org.opencontainers.image.revision=${COMMIT_SHA}" \
  --label "org.opencontainers.image.created=${BUILT_AT}" \
  --label "de.unchainedrobotics.grafana-version=${GRAFANA_VERSION}" \
  "${TAGS[@]}" \
  --file Dockerfile \
  .

note ""
note "Built ${REGISTRY}/${IMAGE}:${VERSION}"

if [ "$PUSH" = true ]; then
  docker push "${REGISTRY}/${IMAGE}:${VERSION}"
  [ "$TAG_LATEST" = true ] && docker push "${REGISTRY}/${IMAGE}:latest"
  note "Pushed."
  note ""
  note "Next: tag the commit so the image can be traced back to it —"
  note "  git tag -a v${VERSION} -m 'Grafana ${GRAFANA_VERSION} + UCR build ${BUILD_NUMBER}'"
  note "  git push origin v${VERSION}"
else
  note ""
  note "Not pushed. Re-run with --push when you are happy with it."
fi
note ""
