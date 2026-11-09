# Stream end-to-end test (real RTMP, real H.264, real decoding)

The app's own `RtmpSink` / `RtmpPublisher` / `RateControl` stream real H.264 (ffmpeg, 5 renditions
switched at key frames as the encoder follows `onBitrate`) in real time, through a link of a given
upload speed (`proxy.py`, token bucket, speed schedule over time), to a real RTMP server (MediaMTX).
A viewer (`recv.py`) pulls the stream with ffmpeg, decodes every frame and times each arrival:
frames a second, every gap over 0.5 s, decode errors.

    ./run.sh NAME "SCHEDULE" SECONDS [manual]     # e.g. ./run.sh link3M "0:3000" 60
                                                  #      ./run.sh dip "0:3000,30:500,45:3000" 90

Needs: MediaMTX listening on :1935, ffmpeg, the app compiled (`rawrec-check/check.sh`), media in
`../media` (`v400|800|1500|3000|6000.h264`, 1280×720 30 fps, key frame each second, AUD on).
