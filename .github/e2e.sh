#!/bin/bash
# The real app on an emulator streams to MediaMTX on the runner (10.0.2.2); a viewer on the runner decodes it.
VER=$(grep -o 'versionName = "[0-9.]*"' app/build.gradle.kts | grep -o '[0-9.]*')
OUT=out/e2e-$VER; rm -rf $OUT; mkdir -p $OUT
PKG=com.vil3ntec.rawrec
A="am start -n $PKG/.E2EActivity"
log() { echo "== $*" | tee -a $OUT/steps.txt; }
consent() {  # Android's capture consent, should the system show it: «entire screen», then start
  for t in 1 2 3 4; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml /tmp/ui.xml >/dev/null 2>&1
    python3 tools/stream-e2e/consent.py /tmp/ui.xml || break
    sleep 2
  done
}

adb install -r -g app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1 | tee -a $OUT/steps.txt
adb shell appops set $PKG PROJECT_MEDIA allow
adb shell appops set $PKG SYSTEM_ALERT_WINDOW allow
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS 2>/dev/null
adb shell pm grant $PKG android.permission.RECORD_AUDIO 2>/dev/null
adb shell wm size | tee -a $OUT/steps.txt
adb shell "dumpsys media.player 2>/dev/null | head -0; cmd media_codec list 2>/dev/null | head -0" >/dev/null
adb shell getprop ro.build.version.release | tee -a $OUT/steps.txt


probe() {  # every recording in the gallery: size, length, decode errors, how much of the frame the picture fills
  adb shell content query --uri content://media/external/video/media --projection _data 2>/dev/null | grep -o '_data=[^,]*' | cut -d= -f2 | tr -d '\r' > $OUT/files-$1.txt
  for f in $(cat $OUT/files-$1.txt); do
    grep -qx "$f" $OUT/seen.txt 2>/dev/null && continue; echo "$f" >> $OUT/seen.txt
    adb pull "$f" /tmp/rec.mp4 >/dev/null 2>&1 || continue
    b=$(basename "$f" .mp4 | tr ' ' '_')
    { echo "== $1: $f"
      ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,avg_frame_rate -of compact /tmp/rec.mp4
      echo "decode errors: $(ffmpeg -v error -i /tmp/rec.mp4 -f null - 2>&1 | wc -l)"
      for t in 1 4 8 14; do echo "at ${t}s picture area: $(ffmpeg -v info -ss $t -i /tmp/rec.mp4 -t 1 -vf cropdetect=limit=24:round=2:reset=1 -f null - 2>&1 | grep -o 'crop=[0-9:]*' | tail -1)"; done
    } >> $OUT/recordings.txt
    for t in 2 10; do ffmpeg -v error -ss $t -i /tmp/rec.mp4 -frames:v 1 -y "$OUT/$1-$b-${t}s.png"; done
  done
}

log "plain recording: started upright, then the app turns landscape (as a game does)"
adb shell $A --es do port
sleep 3
adb shell $A --es do record
sleep 3
consent
sleep 6
adb exec-out screencap -p > $OUT/rot-1-upright.png
adb shell $A --es do land
sleep 14
adb exec-out screencap -p > $OUT/rot-2-landscape.png
adb shell $A --es do stop
sleep 6
adb shell run-as $PKG cat files/rec_log.txt > $OUT/reclog-rotation.txt 2>&1
probe rotation
cat $OUT/recordings.txt

adb shell $A --es do land
sleep 3
log "start live (720p quality) to rtmp://10.0.2.2:1935/live"
adb shell $A --es do live --es url rtmp://10.0.2.2:1935/live --es key test --es quality 0
sleep 4
adb exec-out screencap -p > $OUT/screen-after-start.png
consent
sleep 10
adb exec-out screencap -p > $OUT/screen-live.png
log "viewer 1: free link, 40 s"
python3 tools/stream-e2e/recv.py rtmp://127.0.0.1:1935/live/test 40 2>&1 | tee $OUT/viewer-free.txt
ffmpeg -v error -i rtmp://127.0.0.1:1935/live/test -t 9 -vf fps=0.34 -y $OUT/received-%02d.png
ffprobe -v error -rw_timeout 5000000 -i rtmp://127.0.0.1:1935/live/test -show_entries stream=codec_name,width,height,avg_frame_rate,profile -of compact 2>&1 | tee $OUT/received-stream.txt

log "viewer 2: upload limited to 3 Mbps, 60 s"
adb emu network speed 3000:50000 | tee -a $OUT/steps.txt
python3 tools/stream-e2e/recv.py rtmp://127.0.0.1:1935/live/test 60 2>&1 | tee $OUT/viewer-3M.txt
log "viewer 3: upload limited to 1 Mbps, 60 s"
adb emu network speed 1000:50000 | tee -a $OUT/steps.txt
python3 tools/stream-e2e/recv.py rtmp://127.0.0.1:1935/live/test 60 2>&1 | tee $OUT/viewer-1M.txt
adb emu network speed full | tee -a $OUT/steps.txt

log "clean recording beside the stream: 20 s"
adb shell $A --es do rec
sleep 20
adb shell $A --es do rec
sleep 4
log "stop"
adb shell $A --es do stop
sleep 6
adb shell $A --es do log
sleep 2
adb logcat -d -s RAWREC_E2E:I > $OUT/report.txt
adb logcat -d | grep -iE "rawrec|AndroidRuntime|FATAL|MediaCodec.*(error|fail)" | tail -400 > $OUT/logcat.txt
adb shell run-as $PKG cat files/rec_log.txt > $OUT/reclog-live.txt 2>&1
probe live
cat $OUT/recordings.txt 2>/dev/null
exit 0
