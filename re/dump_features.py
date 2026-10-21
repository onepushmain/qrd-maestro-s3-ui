#!/usr/bin/env python3
# READ-ONLY: issues HID GET_FEATURE (HIDIOCGFEATURE) for each known DS4/vendor report id.
# Sends no SET_ reports; cannot change controller state.
import fcntl, sys, os

DEV = sys.argv[1] if len(sys.argv) > 1 else "/dev/hidraw6"

def ioc(d, t, nr, size):  # Linux _IOC
    return (d << 30) | (size << 16) | (ord(t) << 8) | nr

def hidiocgfeature(size):
    return ioc(3, 'H', 0x07, size)  # dir=READ|WRITE

# report ids seen in the Maestro S3 / DS4 descriptor (feature reports)
IDS = [0x02,0x04,0x05,0x08,0x10,0x11,0x12,0x13,0x14,0x15,0x16,
       0x80,0x81,0x82,0x83,0x84,0x85,0x86,0x87,0x88,0x89,
       0x90,0x91,0x92,0x93,0x94,0xa0,0xa3,0xf0,0xf1,0xf2]

fd = os.open(DEV, os.O_RDWR)
print(f"# feature-report dump of {DEV}  (read-only)\n")
try:
    for rid in IDS:
        buf = bytearray(256); buf[0] = rid
        try:
            n = fcntl.ioctl(fd, hidiocgfeature(len(buf)), buf, True)
        except OSError as e:
            print(f"id 0x{rid:02x}: --  ({e.strerror})"); continue
        data = bytes(buf[:n])
        hexs = ' '.join(f"{b:02x}" for b in data)
        print(f"id 0x{rid:02x} len={n:3d}: {hexs}")
finally:
    os.close(fd)
