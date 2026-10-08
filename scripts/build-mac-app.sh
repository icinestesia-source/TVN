#!/bin/sh
# Builds the TVN Mac app and its installer, in mac-app/. Needs the Xcode command line tools.
#   sh scripts/build-mac-app.sh        TVN.app and TVN.dmg: a native window that opens https://tvn.lol
#   sh scripts/build-mac-app.sh full   TVN Full.app and TVN-Full.dmg: the whole site built into the app, served on
#                                      this Mac only; adding a YouTube channel or podcast still asks tvn.lol
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
src="$root/mac-app/src"
. "$root/scripts/app-version.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

if [ "${1:-}" = full ]; then
  name="TVN Full"
  bundle_id=lol.tvn.app.full
  dmg="$root/mac-app/TVN-Full.dmg"
  sources="$src/SiteServer.swift"
  flags="-D FULL"
  extra="<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>"
  (cd "$root" && npm run build --silent >"$work/site-build.log" 2>&1) || { cat "$work/site-build.log"; exit 1; }
else
  name="TVN"
  bundle_id=lol.tvn.app
  dmg="$root/mac-app/TVN.dmg"
  sources=""
  flags=""
  extra=""
fi
app="$root/mac-app/$name.app"

cp "$src/TVN.swift" "$work/main.swift"
for arch in arm64 x86_64; do
  # shellcheck disable=SC2086
  swiftc -O -swift-version 5 $flags -target "$arch-apple-macos13" "$work/main.swift" $sources -o "$work/TVN-$arch"
done

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
lipo -create "$work/TVN-arm64" "$work/TVN-x86_64" -output "$app/Contents/MacOS/TVN"

sed -e "s/__VERSION__/$version/g" -e "s/__BUILD__/$build/g" -e "s/__COMMIT__/$commit/g" \
  -e "s/__BUNDLE_ID__/$bundle_id/g" -e "s/__NAME__/$name/g" -e "s|<!--EXTRA-->|$extra|" \
  "$src/Info.plist" > "$app/Contents/Info.plist"

if [ -n "$sources" ]; then
  cp -R "$root/dist" "$app/Contents/Resources/site"
  rm -f "$app/Contents/Resources/site/_redirects"
fi

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

codesign --force --deep --sign - "$app" >/dev/null 2>&1

# The installer: the app and a shortcut to Applications, to drag it across.
stage="$work/dmg"
mkdir "$stage"
cp -R "$app" "$stage/"
ln -s /Applications "$stage/Applications"
rm -f "$dmg"
hdiutil create -quiet -volname "$name $version" -srcfolder "$stage" -fs HFS+ -format UDZO "$dmg"
echo "Built $app and $dmg ($name $version, build $build, $commit)"
