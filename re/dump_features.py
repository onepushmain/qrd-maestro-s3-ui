#!/usr/bin/env python3
"""Dump every feature report the controller's HID descriptor declares. Read-only (GET_FEATURE only).

Reports that come back byte for byte identical are grouped: this firmware answers many report IDs
with the same filler buffer, which would otherwise bury the few that carry real data."""
import argparse
import os
import sys

import hidraw


def preview(data, full):
    shown = data if full else data[:40]
    return " ".join(f"{b:02x}" for b in shown) + (" ..." if len(shown) < len(data) else "")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("device", nargs="?", help="hidraw node (default: find the controller)")
    parser.add_argument("--full", action="store_true", help="print every byte instead of the first 40")
    args = parser.parse_args(argv)
    try:
        dev = args.device or hidraw.find_device()
        fd = hidraw.open_device(dev)
        ids = hidraw.feature_report_ids(hidraw.read_descriptor(dev))
    except (hidraw.DeviceNotFound, OSError) as err:
        sys.exit(f"dump_features: {err}")

    groups, rejected = {}, []
    try:
        for report_id in ids:
            try:
                groups.setdefault(hidraw.get_feature(fd, report_id), []).append(report_id)
            except OSError as err:
                rejected.append((report_id, err.strerror))
    finally:
        os.close(fd)

    print(f"# {dev}: {len(ids)} feature reports declared, {len(groups)} distinct replies (read-only)")
    for data, members in sorted(groups.items(), key=lambda kv: kv[1][0]):
        names = " ".join(f"0x{i:02x}" for i in members)
        label = "id" if len(members) == 1 else "ids"
        print(f"\n{label} {names}  ({len(data)} bytes{'' if len(members) == 1 else ' each, identical'})")
        print(f"  {preview(data, args.full)}")
    for report_id, why in rejected:
        print(f"\nid 0x{report_id:02x}: rejected ({why})")


if __name__ == "__main__":
    main()
