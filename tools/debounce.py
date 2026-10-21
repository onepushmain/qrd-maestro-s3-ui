#!/usr/bin/env python3
"""Software chatter filter for a Maestro S3 on Linux. The controller's firmware is not touched.

It grabs the controller's evdev node and re-publishes it as a virtual pad called
"QRD Maestro S3 (debounced)". Buttons, the d-pad and the L2/R2 axes (3K and 4K) that flip again within
the hold-back window (default 8 ms) are treated as switch bounce and swallowed; a real fast tap still
gets through, a few milliseconds late. Stick axes pass through untouched, so directions are not filtered
if you have switched the direction buttons to left or right stick mode. Press Ctrl-C to stop and hand
the controller back.

Only programs that read evdev see the filtered pad. Programs that use SDL's HIDAPI driver (Steam and
most recent games) read /dev/hidraw directly and bypass it; start those with SDL_JOYSTICK_HIDAPI=0.

Needs python-evdev and permission to create virtual devices (tools/install-udev.sh --uinput, or sudo)."""
import argparse
import select
import signal
import sys
import time

from debounce_core import Filter, is_maestro


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--window", type=float, default=8.0, metavar="MS", help="hold-back window in milliseconds (default 8)")
    parser.add_argument("--device", metavar="PATH", help="evdev node to filter (default: find the controller)")
    return parser


def open_source(evdev, path):
    if path:
        return evdev.InputDevice(path)
    found = None
    for candidate in evdev.list_devices():
        dev = evdev.InputDevice(candidate)
        if found is None and is_maestro(dev.name, dev.info.vendor, dev.info.product):
            found = dev
        else:
            dev.close()
    if found is None:
        sys.exit("debounce: Maestro S3 not found. Connect it, or pass --device /dev/input/eventN.")
    return found


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.window <= 0:
        sys.exit("debounce: --window must be greater than zero")
    try:
        import evdev
        from evdev import ecodes as e
    except ImportError:
        sys.exit("debounce: python-evdev is not installed (your distribution's python-evdev package, or pip install --user evdev)")

    src = open_source(evdev, args.device)
    caps = src.capabilities(absinfo=True)
    caps.pop(e.EV_SYN, None)
    caps.pop(e.EV_FF, None)   # the virtual pad does not answer rumble requests, so do not offer them
    try:
        ui = evdev.UInput(caps, name="QRD Maestro S3 (debounced)", vendor=src.info.vendor,
                          product=src.info.product, version=src.info.version)
    except PermissionError:
        sys.exit("debounce: no permission to create virtual devices (install the rules with --uinput, or run with sudo)")
    try:
        src.grab()
    except OSError:
        ui.close()
        sys.exit("debounce: the controller is already grabbed by another program (is debounce running twice?)")

    flt = Filter(args.window / 1000.0)
    signal.signal(signal.SIGTERM, signal.default_int_handler)
    print(f"Filtering {src.path} -> {ui.device.path} (window {args.window:g} ms). Ctrl-C to stop.")

    def apply(actions):
        for action in actions:
            if action[0] == "syn":
                ui.syn()
            else:
                ui.write(*action[1:])

    try:
        while True:
            deadline = flt.next_deadline()
            timeout = None if deadline is None else max(0.0, deadline - time.monotonic())
            ready, _, _ = select.select([src.fd], [], [], timeout)
            now = time.monotonic()
            if ready:
                for ev in src.read():
                    apply(flt.feed(ev.type, ev.code, ev.value, now))
            apply(flt.due(now))
    except KeyboardInterrupt:
        pass
    except OSError as err:
        print(f"debounce: lost the controller ({err.strerror})", file=sys.stderr)
    finally:
        try:
            src.ungrab()
        except OSError:
            pass
        ui.close()
        print(f"\nstopped: {flt.seen} switch changes seen, {flt.seen - flt.forwarded} swallowed as bounce")


if __name__ == "__main__":
    main()
