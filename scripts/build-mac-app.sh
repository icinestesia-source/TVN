#!/bin/sh
# Builds mac-app/TVN.app, a native macOS window that opens https://tvn.lol, and mac-app/TVN.dmg to install it.
# Needs the Xcode command line tools.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
src="$root/mac-app/src"
app="$root/mac-app/TVN.app"
dmg="$root/mac-app/TVN.dmg"
. "$root/scripts/app-version.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13" "$src/TVN.swift" -o "$work/TVN-$arch"
done

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
lipo -create "$work/TVN-arm64" "$work/TVN-x86_64" -output "$app/Contents/MacOS/TVN"

sed -e "s/__VERSION__/$version/g" -e "s/__BUILD__/$build/g" -e "s/__COMMIT__/$commit/g" "$src/Info.plist" > "$app/Contents/Info.plist"

icon="$root/public/android-chrome-512x512.png"
set_dir="$work/TVN.iconset"
mkdir "$set_dir"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$icon" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  if [ "$double" -le 512 ]; then
    sips -z "$double" "$double" "$icon" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
  fi
done
iconutil -c icns "$set_dir" -o "$app/Contents/Resources/TVN.icns"

codesign --force --sign - "$app" >/dev/null 2>&1

# The installer: TVN and a shortcut to Applications, to drag it across.
stage="$work/dmg"
mkdir "$stage"
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
rm -f "$dmg"
hdiutil create -quiet -volname "TVN $version" -srcfolder "$stage" -fs HFS+ -format UDZO "$dmg"
echo "Built $app and $dmg (TVN $version, build $build, $commit)"
