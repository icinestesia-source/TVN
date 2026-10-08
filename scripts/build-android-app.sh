#!/bin/sh
# Builds android-app/TVN.apk: TVN in a full-screen Android web view, for phones, tablets and Android TV.
# Needs the Android SDK (build-tools and a platform) and a JDK; no Gradle. Signed with this machine's Android
# debug key (created if missing), or TVN_ANDROID_KEYSTORE / TVN_ANDROID_KEY_ALIAS / TVN_ANDROID_KEY_PASS if set.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
src="$root/android-app/src"
apk="$root/android-app/TVN.apk"
. "$root/scripts/app-version.sh"

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
tools=$(ls -d "$sdk"/build-tools/* | sort -V | tail -1)
platform=$(ls -d "$sdk"/platforms/android-* | sort -V | tail -1)
JAVA_HOME=${JAVA_HOME:-$(/usr/libexec/java_home -v 17 2>/dev/null || /usr/libexec/java_home)}
export JAVA_HOME
PATH="$JAVA_HOME/bin:$PATH"

keystore="${TVN_ANDROID_KEYSTORE:-$HOME/.android/debug.keystore}"
alias="${TVN_ANDROID_KEY_ALIAS:-androiddebugkey}"
pass="${TVN_ANDROID_KEY_PASS:-android}"
if [ ! -f "$keystore" ]; then
  mkdir -p "$(dirname "$keystore")"
  keytool -genkeypair -quiet -keystore "$keystore" -storepass "$pass" -keypass "$pass" -alias "$alias" \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

icon="$root/public/android-chrome-512x512.png"
res="$work/res"
for density in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  mkdir -p "$res/mipmap-${density%%:*}"
  sips -z "${density##*:}" "${density##*:}" "$icon" --out "$res/mipmap-${density%%:*}/ic_launcher.png" >/dev/null
done
# Android TV shows a 16:9 banner in its launcher.
mkdir -p "$res/drawable-xhdpi"
ffmpeg -v error -y -f lavfi -i "color=c=0x05070c:s=640x360" -i "$icon" \
  -filter_complex "[1]scale=320:320[i];[0][i]overlay=160:20:format=auto" -frames:v 1 "$res/drawable-xhdpi/banner.png"

"$tools/aapt2" compile --dir "$res" -o "$work/res.zip"
"$tools/aapt2" link -o "$work/base.apk" -I "$platform/android.jar" --manifest "$src/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version "${platform##*android-}" \
  --version-code "$(($(date +%s) / 60))" --version-name "$version ($build $commit)" "$work/res.zip"

mkdir "$work/classes"
javac --release 17 -Xlint:-options -classpath "$platform/android.jar" -d "$work/classes" $(find "$src/java" -name "*.java")
"$tools/d8" --release --min-api 24 --lib "$platform/android.jar" --output "$work" $(find "$work/classes" -name '*.class')
(cd "$work" && zip -q base.apk classes.dex)

"$tools/zipalign" -f -p 4 "$work/base.apk" "$work/aligned.apk"
"$tools/apksigner" sign --ks "$keystore" --ks-key-alias "$alias" --ks-pass "pass:$pass" --key-pass "pass:$pass" --out "$apk" "$work/aligned.apk"
"$tools/apksigner" verify "$apk"
rm -f "$apk.idsig"
echo "Built $apk (TVN $version, build $build, $commit)"
