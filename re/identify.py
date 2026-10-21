#!/usr/bin/env python3
# READ-ONLY identity reader: decodes the DS4 info feature reports (0x12 MACs, 0xa3 firmware).
import fcntl, os, sys
DEV = sys.argv[1] if len(sys.argv) > 1 else "/dev/hidraw6"
def ioc(d,t,nr,size): return (d<<30)|(size<<16)|(ord(t)<<8)|nr
def getf(fd, rid, size=64):
    buf = bytearray(size); buf[0]=rid
    n = fcntl.ioctl(fd, ioc(3,'H',0x07,len(buf)), buf, True)
    return bytes(buf[:n])
fd = os.open(DEV, os.O_RDWR)
try:
    r = getf(fd, 0x12, 16)
    cmac = ':'.join(f"{b:02x}" for b in r[6:0:-1])
    hmac = ':'.join(f"{b:02x}" for b in r[15:9:-1])
    print(f"Controller BT MAC : {cmac}")
    print(f"Paired host MAC   : {hmac}")
    a = getf(fd, 0xa3, 49)
    txt = bytes(a[1:]).split(b'\x00')
    strs = [t.decode('latin1') for t in txt if t and all(32<=c<127 for c in t)]
    print(f"Firmware build    : {' '.join(strs[:2])}")
finally:
    os.close(fd)
