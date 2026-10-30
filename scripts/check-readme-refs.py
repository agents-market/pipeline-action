#!/usr/bin/env python3
"""The README must not recommend a ref that can change under a consumer.

Tag `v1` shipped an `action.yml` the runner could not parse, and this README
recommended `@v1` in six places — that is how the broken ref reached
consumers, and every one of them got a red check at "Set up job" with an error
that named neither this repository nor the ref.

A SHA is the only ref that cannot move. This check keeps the examples on one,
and keeps a typo'd SHA from being published: the commit it names has to exist
in this repository.

    python3 scripts/check-readme-refs.py [README.md]
"""

import re
import subprocess
import sys
from pathlib import Path

REPO = "agents-market/pipeline-action"
# A `uses:` line for this action, with the ref it names.
USES = re.compile(r"uses:\s*(?:[\w.-]+/)?agents-market[-/]pipeline-action@([^\s#]+)")
SHA = re.compile(r"^[0-9a-f]{40}$")

README = Path(sys.argv[1] if len(sys.argv) > 1 else "README.md")

failures = []


def check(name, ok, detail=""):
    if ok:
        print(f"ok   {name}")
    else:
        failures.append(name)
        print(f"FAIL {name}" + (f" — {detail}" if detail else ""))


text = README.read_text(encoding="utf-8")
refs = USES.findall(text)

check("the README shows the action at least once", bool(refs), str(len(refs)))

for ref in sorted(set(refs)):
    check(
        f"the README pins {ref[:12]}… to a full commit SHA",
        bool(SHA.match(ref)),
        f"{ref} is not a 40-character SHA",
    )

for ref in sorted(set(refs)):
    if not SHA.match(ref):
        continue
    exists = subprocess.run(
        ["git", "cat-file", "-e", f"{ref}^{{commit}}"],
        capture_output=True,
        text=True,
    ).returncode == 0
    check(f"the commit {ref[:12]}… exists in this repository", exists)

print()
if failures:
    print(f"{len(failures)} checks failed")
    sys.exit(1)
print("all checks passed")
