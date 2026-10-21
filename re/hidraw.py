"""Shared helpers for the read-only HID tools in this folder.

The controller is opened read-only and the only request sent is HID GET_FEATURE, which asks the
device to report something. Nothing here can change what the controller has stored."""
import fcntl
import glob
import os

# HID_ID in the kernel's uevent reads BUS:VENDOR:PRODUCT. Bus 0003 is USB, 0005 is Bluetooth.
CONTROLLER_IDS = ("0003:0000054C:000009CC", "0005:0000054C:000009CC")


class DeviceNotFound(Exception):
    pass


def find_device(sysfs="/sys"):
    """Return the /dev/hidrawN node of the first connected controller (USB or Bluetooth)."""
    for node in sorted(glob.glob(os.path.join(sysfs, "class", "hidraw", "hidraw*"))):
        try:
            with open(os.path.join(node, "device", "uevent")) as f:
                text = f.read().upper()
        except OSError:
            continue
        if any(f"HID_ID={ids}" in text for ids in CONTROLLER_IDS):
            return "/dev/" + os.path.basename(node)
    raise DeviceNotFound("No Maestro S3 (USB id 054C:09CC) found. Connect it and try again.")


def read_descriptor(dev, sysfs="/sys"):
    path = os.path.join(sysfs, "class", "hidraw", os.path.basename(dev), "device", "report_descriptor")
    with open(path, "rb") as f:
        return f.read()


def feature_report_ids(descriptor):
    """Report IDs of every Feature item in a HID report descriptor, sorted, without repeats.

    A report with no Report ID item in force has ID 0."""
    ids, report_id, i = set(), 0, 0
    while i < len(descriptor):
        prefix = descriptor[i]
        if prefix == 0xFE:                      # long item: prefix, data size, tag, then the data
            if i + 1 >= len(descriptor):
                break
            i += 3 + descriptor[i + 1]
            continue
        size = (0, 1, 2, 4)[prefix & 3]
        value = int.from_bytes(descriptor[i + 1:i + 1 + size], "little")
        if prefix & 0xFC == 0x84:               # global item: Report ID
            report_id = value
        elif prefix & 0xFC == 0xB0:             # main item: Feature
            ids.add(report_id)
        i += 1 + size
    return sorted(ids)


def open_device(dev):
    return os.open(dev, os.O_RDONLY)


def get_feature(fd, report_id, length=512):
    """HIDIOCGFEATURE: ask the device for feature report `report_id`."""
    request = (3 << 30) | (length << 16) | (ord("H") << 8) | 0x07
    buf = bytearray(length)
    buf[0] = report_id
    n = fcntl.ioctl(fd, request, buf, True)
    return bytes(buf[:n])
