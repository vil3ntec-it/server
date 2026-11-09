"""A viewer: pulls the stream from the server, decodes every frame, times each one on arrival; reports decode errors, size changes and stalls."""
import subprocess, sys, time, re
url, secs = sys.argv[1], float(sys.argv[2])
W, H = 64, 36
end = time.time() + secs
p = None
while time.time() < end:
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay', '-probesize', '32768', '-analyzeduration', '0', '-rw_timeout', '5000000', '-i', url, '-an', '-fps_mode', 'passthrough', '-vf', f'scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    first = p.stdout.read(W * H)
    if first: break
    p.wait(); time.sleep(1)
arr = [time.time()]
while time.time() < end:
    b = p.stdout.read(W * H)
    if len(b) < W * H: break
    arr.append(time.time())
p.kill(); err = p.stderr.read().decode(errors='replace')
gaps = [b - a for a, b in zip(arr, arr[1:])]
dur = arr[-1] - arr[0]
big = [(round(arr[i]-arr[0],1), round(g,1)) for i, g in enumerate(gaps) if g > 0.5]
print(f"viewer: gaps over 0.5 s at (s from first frame, length): {big}")
print(f"viewer: {len(arr)} frames in {dur:.1f}s = {len(arr)/max(dur,0.1):.1f} fps; longest gap {max(gaps)*1000:.0f} ms; gaps >0.5s: {sum(g>0.5 for g in gaps)}; >2s: {sum(g>2 for g in gaps)}")
errs = [l for l in err.splitlines() if l.strip()]
print(f"viewer: decode errors: {len(errs)}" + ("" if not errs else "  e.g. " + errs[0][:150]))
