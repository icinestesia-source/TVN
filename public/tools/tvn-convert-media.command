#!/bin/bash
# TVN Convert Media (macOS)
#
# Makes video files TVN can play from this computer: AVI (Xvid, DivX), old FLV (Sorenson, VP6), WMV, MPEG,
# VOB, RealMedia and others become MP4 (H.264 picture, AAC or MP3 sound). An MP4 or MOV whose frames are
# timed unevenly, which plays jittery in a browser while its sound is fine, is re-timed to a steady rate.
#
# Every original is left exactly as it is: each conversion is written beside it as "<name> (TVN).mp4", and a
# file already converted is skipped. Needs ffmpeg (brew install ffmpeg). Nothing is uploaded anywhere.
#
# Double-click it to choose a folder, or run:  ./tvn-convert-media.command <file or folder> ...

set -u
shopt -s nocasematch

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "TVN Convert Media needs ffmpeg. Install it with Homebrew:  brew install ffmpeg"
  read -r -p "Press Return to close." _
  exit 1
fi

if [ "$#" -eq 0 ]; then
  folder=$(osascript -e 'POSIX path of (choose folder with prompt "Choose a folder of videos for TVN")' 2>/dev/null) || exit 0
  set -- "$folder"
fi

CONVERT_EXT='avi|divx|xvid|wmv|asf|flv|f4v|mpg|mpeg|mpe|m1v|m2v|vob|ts|m2ts|mts|rm|rmvb|3gp|3g2|mkv|ogm|dv|mxf|swf'
CHECK_EXT='mp4|m4v|mov'
PLAYABLE_VIDEO='h264|vp8|vp9|av1|hevc'
PLAYABLE_AUDIO='aac|mp3'

converted=0
skipped=0
failed=0

# The share of frames, in three samples through the file, that do not follow the file's usual frame spacing.
uneven_share() {
  local file=$1 duration=$2 total=0 odd=0 start
  for fraction in 0.1 0.5 0.85; do
    start=$(awk -v d="$duration" -v f="$fraction" 'BEGIN { printf "%d", d * f }')
    read -r n o < <(ffprobe -v error -select_streams v:0 -read_intervals "${start}%+20" -show_entries packet=pts_time -of csv=p=0 "$file" 2>/dev/null |
      sort -g | awk 'NR > 1 { d = $1 - p; if (d > 0) print d } { p = $1 }' | sort -g |
      awk '{ gaps[++n] = $1 }
        END {
          if (n < 10) { print 0, 0; exit }
          median = gaps[int(n / 2)]; odd = 0
          for (i = 1; i <= n; i++) if (gaps[i] < median * 0.9 || gaps[i] > median * 1.1) odd++
          print n, odd
        }')
    total=$((total + ${n:-0}))
    odd=$((odd + ${o:-0}))
  done
  if [ "$total" -eq 0 ]; then echo 0; else echo $((odd * 100 / total)); fi
}

# The nearest standard frame rate to the file's average, for re-timing it steadily.
steady_rate() {
  awk -v r="$1" 'BEGIN {
    split(r, p, "/"); fps = (p[2] > 0) ? p[1] / p[2] : p[1]
    n = split("23.976 24 25 29.97 30 48 50 59.94 60", rates, " "); best = rates[1]
    for (i = 1; i <= n; i++) if ((rates[i] - fps) ^ 2 < (best - fps) ^ 2) best = rates[i]
    if (best == "23.976") best = "24000/1001"; else if (best == "29.97") best = "30000/1001"; else if (best == "59.94") best = "60000/1001"
    print best
  }'
}

convert_file() {
  local file=$1 name ext out vcodec acodec pix duration rate share
  name=$(basename "$file")
  ext=${name##*.}
  case "$name" in *"(TVN).mp4") return ;; esac
  out="${file%.*} (TVN).mp4"
  if [ -e "$out" ]; then
    echo "  already converted: $name"
    skipped=$((skipped + 1))
    return
  fi
  vcodec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$file" 2>/dev/null | head -1)
  [ -z "$vcodec" ] && return
  acodec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$file" 2>/dev/null | head -1)
  pix=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$file" 2>/dev/null | head -1)
  duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$file" 2>/dev/null | head -1)
  rate=$(ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of csv=p=0 "$file" 2>/dev/null | head -1)

  local video_args=() audio_args=() filter=() why=""
  share=$(uneven_share "$file" "${duration:-0}")
  if [[ "$ext" =~ ^($CHECK_EXT)$ ]]; then
    if [[ "$vcodec" =~ ^($PLAYABLE_VIDEO)$ ]] && [ "$share" -lt 10 ]; then
      skipped=$((skipped + 1))
      return
    fi
  fi
  if [ "$share" -ge 10 ]; then
    filter=(-vf "fps=$(steady_rate "$rate")")
    why="re-timed (${share}% of frames uneven)"
  fi
  if [ ${#filter[@]} -eq 0 ] && [[ "$vcodec" =~ ^(h264)$ ]] && [ "$pix" = "yuv420p" ]; then
    video_args=(-c:v copy)
    why="${why:-repackaged}"
  else
    video_args=(-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p ${filter[@]+"${filter[@]}"})
    why="${why:-converted from $vcodec}"
  fi
  if [ -z "$acodec" ]; then
    audio_args=(-an)
  elif [[ "$acodec" =~ ^($PLAYABLE_AUDIO)$ ]]; then
    audio_args=(-c:a copy)
  else
    audio_args=(-c:a aac -b:a 160k)
  fi

  echo "  $name: $why"
  if ffmpeg -hide_banner -loglevel error -stats -nostdin -i "$file" -map 0:v:0 -map "0:a:0?" ${video_args[@]+"${video_args[@]}"} ${audio_args[@]+"${audio_args[@]}"} -movflags +faststart "$out.part.mp4" &&
    mv "$out.part.mp4" "$out"; then
    converted=$((converted + 1))
  else
    rm -f "$out.part.mp4"
    echo "    could not convert $name"
    failed=$((failed + 1))
  fi
}

for target in "$@"; do
  if [ -d "$target" ]; then
    echo "Looking in $target"
    while IFS= read -r -d '' file; do
      convert_file "$file"
    done < <(find -E "$target" -type f -iregex ".*\.($CONVERT_EXT|$CHECK_EXT)" ! -name '.*' -print0 | sort -z)
  elif [ -f "$target" ]; then
    convert_file "$target"
  fi
done

echo
echo "Done: $converted converted, $skipped left as they are, $failed could not be converted."
echo "Add the \"(TVN).mp4\" files to TVN with MEDIA."
[ -t 0 ] && read -r -p "Press Return to close." _
exit 0
