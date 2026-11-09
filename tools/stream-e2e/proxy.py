"""A link of a given upload speed between the app's sender and the RTMP server (token bucket, schedule in kbps over time)."""
import socket, threading, time, sys
listen, target, sched = int(sys.argv[1]), int(sys.argv[2]), [tuple(map(float, x.split(':'))) for x in sys.argv[3].split(',')]
t0 = None
def rate():
    t = time.time() - (t0 or time.time()); r = sched[0][1]
    for at, k in sched:
        if t >= at: r = k
    return r * 1000 / 8   # bytes/s
def up(a, b):
    global t0
    t0 = t0 or time.time(); tokens = 0.0; last = time.time()
    while True:
        d = a.recv(8192)
        if not d: break
        i = 0
        while i < len(d):
            now = time.time(); tokens = min(tokens + (now - last) * rate(), rate() * 0.05); last = now
            if tokens < 1: time.sleep(0.002); continue
            n = int(min(tokens, len(d) - i)); b.sendall(d[i:i+n]); i += n; tokens -= n
    b.close()
def down(a, b):
    while True:
        d = a.recv(65536)
        if not d: break
        b.sendall(d)
    b.close()
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', listen)); s.listen(4)
while True:
    c, _ = s.accept(); u = socket.create_connection(('127.0.0.1', target))
    for sk in (c, u): sk.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 64 * 1024)
    threading.Thread(target=up, args=(c, u), daemon=True).start(); threading.Thread(target=down, args=(u, c), daemon=True).start()
