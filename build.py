#!/usr/bin/env python3
"""Build the single-file, offline visceral-fat-3d.html.

  python3 build.py            -> ./visceral-fat-3d.html (minified)
  python3 build.py --dev      -> readable bundle (no minify) for debugging
  python3 build.py --out X    -> write to a different path
"""
import os, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
ENTRY = ROOT / "src" / "main.js"
TEMPLATE = ROOT / "src" / "template.html"
OUT = ROOT / "visceral-fat-3d.html"
MAX_BYTES = 8 * 1024 * 1024

def main(argv):
    out = OUT
    minify = True
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--dev":
            minify = False
        elif a == "--out":
            i += 1
            out = pathlib.Path(argv[i]).resolve()
        i += 1
    esbuild = ROOT / "node_modules" / ".bin" / "esbuild"
    if not esbuild.exists():
        sys.exit("esbuild not found - run `npm install` in %s" % ROOT)
    cmd = [str(esbuild), str(ENTRY), "--bundle", "--format=iife",
           "--target=es2020", "--charset=utf8", "--log-level=warning",
           "--legal-comments=inline"]
    if minify:
        cmd.append("--minify")
    js = subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True).stdout.decode("utf-8")
    # never let a stray </script> break the page
    js = js.replace("</script", "<\\/script")
    tpl = TEMPLATE.read_text(encoding="utf-8")
    assert "/*APP*/" in tpl, "template.html lost its /*APP*/ marker"
    html = tpl.replace("/*APP*/", js, 1)
    out.write_text(html, encoding="utf-8")
    size = out.stat().st_size
    print("wrote %s  (%.1f KB, js %.1f KB%s)" % (out, size / 1024, len(js) / 1024, "" if minify else ", dev"))
    if size > MAX_BYTES:
        print("WARNING: output exceeds 8 MB budget", file=sys.stderr)

if __name__ == "__main__":
    main(sys.argv[1:])
