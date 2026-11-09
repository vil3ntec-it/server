#!/bin/bash
# run.sh NAME SCHEDULE SECONDS [manual]  — one end-to-end case through a link of the given speed
cd "$(dirname "$0")"
C=/root/.gradle/caches/modules-2/files-2.1; CP=.:/home/user/rawrec-check/build/classes/kotlin/main:$C/org.jetbrains.kotlin/kotlin-stdlib/2.0.21/618b539767b4899b4660a83006e052b63f1db551/kotlin-stdlib-2.0.21.jar:$(cat /home/user/rawrec-check/build/android-all.path)
PORT=$((19400 + RANDOM % 500))
python3 proxy.py $PORT 1935 "$2" > /dev/null 2>&1 & PX=$!
sleep 0.5
python3 recv.py rtmp://127.0.0.1:1935/live/test $(( $3 - 4 )) > recv-$1.txt 2>&1 & RV=$!
env -u JAVA_TOOL_OPTIONS java -cp "$CP" E2E ../media rtmp://127.0.0.1:$PORT/live $3 $4 > feed-$1.txt 2>&1
wait $RV; kill $PX 2>/dev/null
echo "== $1 (link: $2 kbps over time$( [ -n "$4" ] && echo ", manual"))"; cat feed-$1.txt; cat recv-$1.txt
