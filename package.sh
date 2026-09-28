#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/bahoosh-analytics-pro"
VERSION="$(grep -oP "define\( 'BAP_VERSION', '\K[^']+" "$SRC/bahoosh-analytics-pro.php")"
OUT="$ROOT/dist/bahoosh-analytics-pro-${VERSION}.zip"
STAGE="$(mktemp -d)"

echo "Packaging ${VERSION}"
echo "  · PHP syntax"; find "$SRC" -name '*.php' -print0 | xargs -0 -n1 php -l > /dev/null
echo "  · JS syntax";  for f in $(find "$SRC" -name '*.js'); do node --check "$f"; done
echo "  · tracker bundle is current"; node "$SRC/tools/build-bundle.js" --check

# The 4.9.0 notes promise version metadata cannot silently drift. It could:
# nothing checked. 4.10.0 shipped with the readme still reading 4.9.0.
echo "  · version metadata agrees"
HEADER="$(grep -oP '^ \* Version:\s+\K\S+' "$SRC/bahoosh-analytics-pro.php")"
STABLE="$(grep -oP '^Stable tag:\s+\K\S+' "$SRC/readme.txt")"
for pair in "plugin header:$HEADER" "readme Stable tag:$STABLE"; do
  if [ "${pair#*:}" != "$VERSION" ]; then
    echo "    ! ${pair%%:*} says ${pair#*:}, BAP_VERSION says $VERSION" >&2
    exit 1
  fi
done
if ! grep -q "^= ${VERSION} =$" "$SRC/readme.txt"; then
  echo "    ! the changelog has no entry for $VERSION" >&2
  exit 1
fi

# 4.9.0 shipped with assets/js/core/ deleted, leaving only the built bundle —
# so the file every visitor's browser loads could not be rebuilt or reviewed.
echo "  · tracker sources are present"
for required in assets/js/core assets/js/integrations tools docs; do
  if [ ! -d "$SRC/$required" ]; then
    echo "    ! $required is missing; the bundle would ship unmaintainable" >&2
    exit 1
  fi
done

echo "  · staging"
mkdir -p "$STAGE/bahoosh-analytics-pro"
( cd "$SRC" && tar --exclude='.git' --exclude='node_modules' --exclude='.env' \
   --exclude='*.log' --exclude='.DS_Store' -cf - . ) | ( cd "$STAGE/bahoosh-analytics-pro" && tar -xf - )

echo "  · checking for secrets and stray identifiers"
if grep -rniE 'sk-[a-z0-9]{20,}|api[_-]?key["'"'"']\s*[:=]\s*["'"'"'][a-z0-9]{20,}' "$STAGE" >/dev/null 2>&1; then
  echo "    ! a literal key is present" >&2; exit 1
fi
if grep -rP "class_exists\(\s*'[^']*[\x{0600}-\x{06FF}]" "$STAGE" --include='*.php' >/dev/null 2>&1; then
  echo "    ! a PHP identifier has been translated" >&2; exit 1
fi

echo "  · archiving"
mkdir -p "$ROOT/dist"; rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" bahoosh-analytics-pro )
rm -rf "$STAGE"
echo ""; echo "Wrote $OUT"
echo "  size:  $(du -h "$OUT" | cut -f1)"
echo "  files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"
