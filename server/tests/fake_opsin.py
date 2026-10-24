"""Stands in for server/opsin/OpsinLines.java in tests: same READY line and answer format.

    python fake_opsin.py <version>

How it answers a name:
  "ok:<smiles>"    OK with that SMILES          "fail:<text>"  FAIL with "fake failure: <text>"
  "warn:<smiles>"  WARN with a fake message     "hang"         never answers
  "die"            exits                        "garbled"      a line not in the format
  anything else    OK with "smiles-of-<name>" (not a real SMILES)
"""

import sys
import time

print(f"READY\t{sys.argv[1]}", flush=True)
for line in sys.stdin:
    name = line.rstrip("\n")
    if name == "hang":
        while True:
            time.sleep(60)
    if name == "die":
        sys.exit(3)
    if name == "garbled":
        answer = "garbled"
    elif name.startswith("ok:"):
        answer = f"OK\t{name[3:]}\t"
    elif name.startswith("warn:"):
        answer = f"WARN\t{name[5:]}\tfake warning"
    elif name.startswith("fail:"):
        answer = f"FAIL\t\tfake failure: {name[5:]}"
    else:
        answer = f"OK\tsmiles-of-{name}\t"
    print(answer, flush=True)
