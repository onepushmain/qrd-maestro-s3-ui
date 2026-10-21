#!/usr/bin/env python3
"""Find out whether a controller setting is visible over USB, using only read requests.

  python3 re/snapshot.py save snapshots/before.json    # save every feature report the controller declares
  (change ONE setting on the controller with its button combo, for example the SOCD mode)
  python3 re/snapshot.py save snapshots/after.json
  python3 re/snapshot.py diff snapshots/before.json snapshots/after.json

Snapshots hold raw reports, including the controller's Bluetooth MAC, so keep them out of git
(the snapshots/ folder is already ignored)."""
import argparse
import json
import os
import sys

import hidraw


def take_snapshot(get, ids):
    """{report id as two hex digits: report bytes as hex}, skipping IDs the device rejects."""
    out = {}
    for report_id in ids:
        try:
            out[f"{report_id:02x}"] = get(report_id).hex()
        except OSError:
            continue
    return out


def diff_reports(a, b):
    """[(report id, [(offset, old byte, new byte), ...]), ...] for every report that differs.

    A byte missing because one report is shorter shows as None."""
    out = []
    for report_id in sorted(set(a) | set(b)):
        x, y = bytes.fromhex(a.get(report_id, "")), bytes.fromhex(b.get(report_id, ""))
        changes = []
        for i in range(max(len(x), len(y))):
            old = x[i] if i < len(x) else None
            new = y[i] if i < len(y) else None
            if old != new:
                changes.append((i, old, new))
        if changes:
            out.append((report_id, changes))
    return out


def _hex(byte):
    return "--" if byte is None else f"{byte:02x}"


def print_diff(changes):
    if not changes:
        print("No feature report changed. Either that setting is not visible over USB, "
              "or it only takes effect after the controller reconnects.")
        return
    for report_id, offsets in changes:
        print(f"report 0x{report_id}: {len(offsets)} byte(s) changed")
        for i, old, new in offsets[:24]:
            print(f"   [{i:3d}] {_hex(old)} -> {_hex(new)}")
        if len(offsets) > 24:
            print(f"   ... and {len(offsets) - 24} more")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    save = sub.add_parser("save", help="read every feature report and save it to a JSON file")
    save.add_argument("file")
    save.add_argument("--device", help="hidraw node (default: find the controller)")
    diff = sub.add_parser("diff", help="show which bytes differ between two saved snapshots")
    diff.add_argument("before")
    diff.add_argument("after")
    args = parser.parse_args(argv)

    if args.command == "diff":
        with open(args.before) as a, open(args.after) as b:
            print_diff(diff_reports(json.load(a), json.load(b)))
        return

    try:
        dev = args.device or hidraw.find_device()
        fd = hidraw.open_device(dev)
        ids = hidraw.feature_report_ids(hidraw.read_descriptor(dev))
    except (hidraw.DeviceNotFound, OSError) as err:
        sys.exit(f"snapshot: {err}")
    try:
        snap = take_snapshot(lambda rid: hidraw.get_feature(fd, rid), ids)
    finally:
        os.close(fd)
    os.makedirs(os.path.dirname(os.path.abspath(args.file)), exist_ok=True)
    with open(args.file, "w") as f:
        json.dump(snap, f, indent=1)
    print(f"saved {len(snap)} reports from {dev} to {args.file}")


if __name__ == "__main__":
    main()
