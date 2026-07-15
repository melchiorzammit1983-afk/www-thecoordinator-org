#!/usr/bin/env bash
# Build a signed release APK for the Coordinator Driver app.
#
# Prerequisites (one-time, on the developer machine):
#   - Android Studio + JDK 17
#   - bun install
#   - npx cap add android
#   - Edit android/app/src/main/AndroidManifest.xml permissions (see
#     docs/native-app.md and docs/MOBILE_DEPLOYMENT_COMPLETED.md).
#   - Generate an upload keystore and place it at ~/keystores/driver-upload.keystore
#   - Export the signing env vars used by android/app/build.gradle:
#       ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD,
#       ANDROID_KEY_ALIAS,     ANDROID_KEY_PASSWORD
#
# This script cannot run inside the Lovable sandbox (no Android SDK).
set -euo pipefail

VERSION="${1:-$(date +%Y%m%d-%H%M)}"
OUT_DIR="dist-apk"
mkdir -p "$OUT_DIR"

echo "==> bun run build"
bun run build

echo "==> npx cap sync android"
npx cap sync android

echo "==> gradlew assembleRelease"
pushd android >/dev/null
./gradlew assembleRelease
popd >/dev/null

SRC="android/app/build/outputs/apk/release/app-release.apk"
DEST="$OUT_DIR/driver-v${VERSION}.apk"
cp "$SRC" "$DEST"
cp "$SRC" "$OUT_DIR/driver-latest.apk"

echo "==> APK: $DEST"
echo "Upload to public/downloads/ and update public/releases.json."
