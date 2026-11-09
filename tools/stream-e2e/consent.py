"""Taps Android's capture consent: «A single app» switched to «Entire screen» first, then start.
Exit 1 when it tapped something (look again), 0 when nothing of the dialog is on the screen."""
import re, subprocess, sys
x = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
def tap(label):
    m = re.search(r'text="%s"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"' % re.escape(label), x)
    if not m:
        return False
    a, b, c, d = map(int, m.groups())
    subprocess.run(['adb', 'shell', 'input', 'tap', str((a + c) // 2), str((b + d) // 2)])
    print('tapped', label)
    return True
if 'A single app' in x and 'Entire screen' not in x:
    tap('A single app'); sys.exit(1)       # open the choice
if tap('Entire screen'):
    sys.exit(1)
for label in ['Got it', 'Start now', 'START NOW', 'Share screen', 'Start', 'Next', 'Allow']:
    if tap(label):
        sys.exit(1)
sys.exit(0)
