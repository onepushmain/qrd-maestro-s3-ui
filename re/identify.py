#!/usr/bin/env python3
"""Print the controller's Bluetooth MAC, the MAC of the host it is paired with, and its firmware build string.

Read-only: it only asks for the standard DualShock 4 info reports (0x12 and 0xA3).
The MAC is what tools/install-udev.sh uses to tell your controller apart from a real DualShock 4."""
import argparse
import os
import sys

import hidraw


def _mac(raw):
    """Reports store a MAC least significant byte first."""
    return ":".join(f"{b:02x}" for b in reversed(raw))


def parse_pairing(report):
    """Report 0x12: byte 0 is the ID, then the controller MAC, three bytes, then the host MAC."""
    return _mac(report[1:7]), _mac(report[10:16])


def parse_firmware(report):
    """Report 0xA3: the build date and time are NUL-separated text near the start."""
    parts = report[1:].split(b"\x00")
    words = [p.decode("ascii") for p in parts if p and all(32 <= c < 127 for c in p)]
    return " ".join(words[:2])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("device", nargs="?", help="hidraw node (default: find the controller)")
    args = parser.parse_args(argv)
    try:
        dev = args.device or hidraw.find_device()
        fd = hidraw.open_device(dev)
    except (hidraw.DeviceNotFound, OSError) as err:
        sys.exit(f"identify: {err}")
    try:
        controller, host = parse_pairing(hidraw.get_feature(fd, 0x12, 16))
        firmware = parse_firmware(hidraw.get_feature(fd, 0xA3, 49))
    except OSError as err:
        sys.exit(f"identify: {dev} did not answer the info request ({err.strerror})")
    finally:
        os.close(fd)
    print(f"Controller Bluetooth MAC : {controller}")
    print(f"Paired host MAC          : {host}")
    print(f"Firmware build string    : {firmware}")


if __name__ == "__main__":
    main()
