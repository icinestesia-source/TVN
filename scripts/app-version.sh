# Sourced by the app builds: one version for the Mac and Android apps, from package.json and the commit built.
version=$(node -p "require('$root/package.json').version")
build=$(date +%Y%m%d.%H%M)
commit=$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo unknown)
if [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ]; then commit="$commit+local"; fi
