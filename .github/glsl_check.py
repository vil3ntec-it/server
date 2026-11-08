"""Every shader in LookFilter.kt through glslangValidator as GLSL ES 1.00 (and the layer pairs linked)."""
import os, re, subprocess, sys, tempfile

src = open(sys.argv[1], encoding="utf-8").read()
consts = {}
for m in re.finditer(r"const val (\w+)\s*=\s*", src):
    i, parts = m.end(), []
    while True:
        while src[i] in " \t\r\n":
            i += 1
        if src.startswith('"""', i):
            j = src.index('"""', i + 3)
            parts.append(("s", src[i + 3:j])); i = j + 3
        else:
            mm = re.match(r"[A-Z_][A-Z0-9_]*", src[i:])
            if not mm:
                break
            parts.append(("n", mm.group(0))); i += mm.end()
        k = i
        while src[k] in " \t\r\n":
            k += 1
        if src[k] == "+":
            i = k + 1
            continue
        break
    if parts:
        consts[m.group(1)] = parts

def ev(name):
    return "".join(v if t == "s" else ev(v) for t, v in consts[name])

out, bad = [], 0
tmp = tempfile.mkdtemp()
files = {}
for name in consts:
    try:
        body = ev(name)
    except KeyError:
        continue
    if "void main" not in body:
        continue
    stage = "vert" if "gl_Position" in body else "frag"
    path = os.path.join(tmp, f"{name}.{stage}")
    open(path, "w").write("#version 100\n" + body)
    files[name] = path
    r = subprocess.run(["glslangValidator", path], capture_output=True, text=True)
    ok = r.returncode == 0
    bad += not ok
    out.append(f"{'OK  ' if ok else 'FAIL'} {name} ({stage})" + ("" if ok else "\n" + r.stdout + r.stderr))
for vs, fs in [("VS_LAYER", "FS_LAYER"), ("VS_LAYER", "FS_LAYER_EXT")]:
    if vs in files and fs in files:
        r = subprocess.run(["glslangValidator", "-l", files[vs], files[fs]], capture_output=True, text=True)
        ok = r.returncode == 0
        bad += not ok
        out.append(f"{'OK  ' if ok else 'FAIL'} link {vs} + {fs}" + ("" if ok else "\n" + r.stdout + r.stderr))
text = f"shaders checked {len(files)}, failed {bad}\n" + "\n".join(out) + "\n"
open(sys.argv[2], "w").write(text)
print(text)
