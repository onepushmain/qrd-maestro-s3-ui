#!/usr/bin/env python3
# Software chatter filter for the Maestro S3 (Linux only, runs on the host — firmware untouched).
# Grabs the controller's evdev node, drops key transitions that arrive within DEBOUNCE_MS of the
# previous transition on the same key, and re-emits everything through a virtual pad (uinput).
# Games see "QRD Maestro S3 (debounced)" instead of the raw device. Ctrl-C restores the original.
#
# Needs: pip install --user evdev   and uinput access (build 2 udev rule, or run with sudo).
# Usage: python3 tools/debounce.py [debounce_ms]
import sys, time
import evdev
from evdev import ecodes as e

DEBOUNCE_MS = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0
NAME = "Sony Interactive Entertainment Wireless Controller"

src = next((evdev.InputDevice(p) for p in evdev.list_devices()
            if evdev.InputDevice(p).name == NAME), None)
if src is None:
    sys.exit("Maestro S3 not found")

caps = src.capabilities(absinfo=True)
caps.pop(e.EV_SYN, None)
ui = evdev.UInput(caps, name="QRD Maestro S3 (debounced)", vendor=src.info.vendor,
                  product=src.info.product, version=src.info.version)

last = {}       # key code -> time of last accepted transition
dropped = 0
src.grab()      # hide the raw device from games while we run
print(f"Filtering {src.path} -> {ui.device.path}  ({DEBOUNCE_MS} ms). Ctrl-C to stop.")
try:
    for ev in src.read_loop():
        if ev.type == e.EV_KEY and ev.value in (0, 1):
            now = time.monotonic() * 1000
            if now - last.get(ev.code, -1e9) < DEBOUNCE_MS:
                dropped += 1
                continue
            last[ev.code] = now
        ui.write_event(ev)
except KeyboardInterrupt:
    pass
finally:
    src.ungrab()
    ui.close()
    print(f"\nstopped; dropped {dropped} bounce transition(s)")
