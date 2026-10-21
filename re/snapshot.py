#!/usr/bin/env python3
# READ-ONLY config-diff harness for decoding the Maestro S3's settings.
#
#   python3 re/snapshot.py save before.json      # snapshot every feature report
#   (change ONE setting on the controller with its button combo, e.g. SOCD mode)
#   python3 re/snapshot.py save after.json
#   python3 re/snapshot.py diff before.json after.json
#
# Only HID GET_FEATURE is used; nothing is ever sent to the controller.
import fcntl, json, os, sys, glob

def ioc(d, t, nr, size):
    return (d << 30) | (size << 16) | (ord(t) << 8) | nr

def find_dev():
    for h in sorted(glob.glob("/sys/class/hidraw/hidraw*")):
        try:
            ue = open(h + "/device/uevent").read()
        except OSError:
            continue
        if "054C:000009CC" in ue.upper():
            return "/dev/" + os.path.basename(h)
    sys.exit("Maestro S3 (054C:09CC) not found")

def feature_ids(dev):
    # Walk the HID report descriptor; collect the Report ID in force at each Feature main item.
    rd = open(f"/sys/class/hidraw/{os.path.basename(dev)}/device/report_descriptor", "rb").read()
    ids, rid, i = set(), 0, 0
    while i < len(rd):
        b = rd[i]; size = (0, 1, 2, 4)[b & 3]
        val = int.from_bytes(rd[i + 1:i + 1 + size], "little")
        if b & 0xfc == 0x84:      # Report ID (global)
            rid = val
        elif b & 0xfc == 0xb0:    # Feature (main)
            ids.add(rid)
        i += 1 + size
    return sorted(ids)

def snapshot(dev):
    out = {}
    fd = os.open(dev, os.O_RDWR)
    try:
        for rid in feature_ids(dev):
            buf = bytearray(512); buf[0] = rid
            try:
                n = fcntl.ioctl(fd, ioc(3, 'H', 0x07, len(buf)), buf, True)
            except OSError:
                continue
            out[f"{rid:02x}"] = bytes(buf[:n]).hex()
    finally:
        os.close(fd)
    return out

def diff(a, b):
    changed = 0
    for rid in sorted(set(a) | set(b)):
        x, y = bytes.fromhex(a.get(rid, "")), bytes.fromhex(b.get(rid, ""))
        if x == y:
            continue
        changed += 1
        offs = [i for i in range(max(len(x), len(y)))
                if (x[i] if i < len(x) else None) != (y[i] if i < len(y) else None)]
        print(f"report 0x{rid}: {len(offs)} byte(s) changed")
        for i in offs[:24]:
            bx = f"{x[i]:02x}" if i < len(x) else "--"
            by = f"{y[i]:02x}" if i < len(y) else "--"
            print(f"   [{i:3d}] {bx} -> {by}")
    if not changed:
        print("No feature report changed. That setting is not exposed over HID "
              "feature reports (it lives only in on-device flash).")

if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "save":
        dev = sys.argv[3] if len(sys.argv) > 3 else find_dev()
        snap = snapshot(dev)
        json.dump(snap, open(sys.argv[2], "w"), indent=1)
        print(f"saved {len(snap)} reports from {dev} -> {sys.argv[2]}")
    elif len(sys.argv) == 4 and sys.argv[1] == "diff":
        diff(json.load(open(sys.argv[2])), json.load(open(sys.argv[3])))
    else:
        print(__doc__ or "usage: snapshot.py save FILE | diff A B")
