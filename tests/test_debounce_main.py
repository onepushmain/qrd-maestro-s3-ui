"""Runs tools/debounce.py's main() against a stand-in for python-evdev, so nothing here touches a real input device.

The stand-in device is fed through a real pipe, so main()'s select loop really waits and wakes."""
import contextlib
import io
import os
import pathlib
import signal
import sys
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import debounce  # noqa: E402

EV_SYN, EV_KEY, EV_ABS, EV_FF = 0, 1, 3, 0x15
BTN_SOUTH = 0x130


class Event:
    def __init__(self, ev_type, code, value):
        self.type, self.code, self.value = ev_type, code, value


PRESS, RELEASE, SYN = Event(EV_KEY, BTN_SOUTH, 1), Event(EV_KEY, BTN_SOUTH, 0), Event(EV_SYN, 0, 0)


class FakeDevice:
    def __init__(self, path, name="Sony Interactive Entertainment Wireless Controller", vendor=0x054C, product=0x09CC,
                 uniq="aa:bb:cc:dd:ee:ff", batches=()):
        self.path, self.name, self.uniq = path, name, uniq
        self.info = types.SimpleNamespace(vendor=vendor, product=product, version=0x8111)
        self.batches = [list(b) for b in batches]
        self._read_end, self._write_end = os.pipe()
        os.write(self._write_end, b"x" * len(self.batches))   # one wake-up per batch
        self.fd = self._read_end
        self.reads = 0
        self.closed = self.grabbed = self.ungrabbed = False

    def capabilities(self, absinfo=False):
        return {EV_SYN: [0], EV_KEY: [BTN_SOUTH], EV_ABS: [(0, None)], EV_FF: [80]}

    def read(self):
        os.read(self._read_end, 1)
        self.reads += 1
        if not self.batches:
            raise KeyboardInterrupt
        return iter(self.batches.pop(0))

    def grab(self):
        self.grabbed = True

    def ungrab(self):
        self.ungrabbed = True

    def close(self):
        self.closed = True


class FakeEvdev(types.ModuleType):
    """The few parts of python-evdev that debounce.py uses."""

    class UInputError(Exception):
        pass

    def __init__(self, devices, stop_after_syns=None, uinput_error=None):
        super().__init__("evdev")
        self.devices = {d.path: d for d in devices}
        self.uinput_error = uinput_error
        self.created = []
        self.ecodes = types.SimpleNamespace(EV_SYN=EV_SYN, EV_KEY=EV_KEY, EV_ABS=EV_ABS, EV_FF=EV_FF)
        outer = self

        class UInput:
            def __init__(self, caps, **kwargs):
                if outer.uinput_error:
                    raise outer.uinput_error
                self.caps, self.kwargs, self.log, self.closed = caps, kwargs, [], False
                self.device = types.SimpleNamespace(path="/dev/input/event99")
                outer.created.append(self)

            def write(self, ev_type, code, value):
                self.log.append(("write", ev_type, code, value))

            def syn(self):
                self.log.append(("syn",))
                if stop_after_syns and sum(1 for e in self.log if e == ("syn",)) >= stop_after_syns:
                    raise KeyboardInterrupt

            def close(self):
                self.closed = True

        self.UInput = UInput

    def list_devices(self):
        return list(self.devices)

    def InputDevice(self, path):
        return self.devices[path]


def run_main(fake, *argv):
    """Run debounce.main() with `fake` standing in for evdev; return (exit message or None, printed output)."""
    saved_sigterm, saved_modules = signal.getsignal(signal.SIGTERM), {k: sys.modules.get(k) for k in ("evdev", "evdev.ecodes")}
    sys.modules["evdev"], sys.modules["evdev.ecodes"] = fake, fake.ecodes
    out, exit_message = io.StringIO(), None
    try:
        with contextlib.redirect_stdout(out):
            debounce.main(list(argv))
    except SystemExit as err:
        exit_message = str(err.code)
    finally:
        signal.signal(signal.SIGTERM, saved_sigterm)
        for key, value in saved_modules.items():
            if value is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = value
    return exit_message, out.getvalue()


class Main(unittest.TestCase):
    def test_a_held_back_release_reaches_the_pad_in_a_packet_of_its_own(self):
        pad = FakeDevice("/dev/input/event7", batches=[[PRESS, SYN], [RELEASE, SYN]])
        fake = FakeEvdev([pad], stop_after_syns=2)
        message, out = run_main(fake, "--device", pad.path, "--window", "8")
        self.assertIsNone(message)
        # the release was held back, then written with a SYN of its own when the window ended
        self.assertEqual(fake.created[0].log, [("write", EV_KEY, BTN_SOUTH, 1), ("syn",), ("write", EV_KEY, BTN_SOUTH, 0), ("syn",)])

    def test_stopping_hands_the_pad_back_and_says_what_it_swallowed(self):
        pad = FakeDevice("/dev/input/event7", batches=[[PRESS, SYN]])
        fake = FakeEvdev([pad], stop_after_syns=1)
        _, out = run_main(fake, "--device", pad.path)
        self.assertTrue(pad.grabbed and pad.ungrabbed)
        self.assertTrue(fake.created[0].closed)
        self.assertIn("swallowed", out)

    def test_the_virtual_pad_does_not_offer_rumble_or_a_raw_syn(self):
        pad = FakeDevice("/dev/input/event7", batches=[[PRESS, SYN]])
        fake = FakeEvdev([pad], stop_after_syns=1)
        run_main(fake, "--device", pad.path)
        self.assertNotIn(EV_FF, fake.created[0].caps)
        self.assertNotIn(EV_SYN, fake.created[0].caps)
        self.assertEqual(fake.created[0].kwargs["name"], "QRD Maestro S3 (debounced)")

    def test_the_pad_is_found_over_bluetooth_where_it_is_named_plainly(self):
        keyboard = FakeDevice("/dev/input/event3", name="Keychron K8 Pro", vendor=0x3434, product=0x0280)
        sensors = FakeDevice("/dev/input/event5", name="Wireless Controller Motion Sensors")
        pad = FakeDevice("/dev/input/event6", name="Wireless Controller", batches=[[PRESS, SYN]])
        fake = FakeEvdev([keyboard, sensors, pad], stop_after_syns=1)
        message, _ = run_main(fake)
        self.assertIsNone(message)
        self.assertTrue(pad.grabbed)
        self.assertEqual((keyboard.grabbed, sensors.grabbed), (False, False))
        self.assertTrue(keyboard.closed and sensors.closed)   # the candidates that were not chosen are released

    def test_mac_option_chooses_between_two_pads(self):
        first = FakeDevice("/dev/input/event6", uniq="aa:bb:cc:dd:ee:ff", batches=[[PRESS, SYN]])
        second = FakeDevice("/dev/input/event8", uniq="11:22:33:44:55:66", batches=[[PRESS, SYN]])
        fake = FakeEvdev([first, second], stop_after_syns=1)
        run_main(fake, "--mac", "11:22:33:44:55:66")
        self.assertEqual((first.grabbed, second.grabbed), (False, True))

    def test_without_mac_the_first_pad_is_taken(self):
        first = FakeDevice("/dev/input/event6", uniq="aa:bb:cc:dd:ee:ff", batches=[[PRESS, SYN]])
        second = FakeDevice("/dev/input/event8", uniq="11:22:33:44:55:66", batches=[[PRESS, SYN]])
        run_main(FakeEvdev([first, second], stop_after_syns=1))
        self.assertEqual((first.grabbed, second.grabbed), (True, False))

    def test_no_pad_is_explained(self):
        keyboard = FakeDevice("/dev/input/event3", name="Keychron K8 Pro", vendor=0x3434, product=0x0280)
        message, _ = run_main(FakeEvdev([keyboard]))
        self.assertIn("not found", message)

    def test_a_pad_with_another_mac_is_not_found_when_one_is_asked_for(self):
        pad = FakeDevice("/dev/input/event6", uniq="aa:bb:cc:dd:ee:ff")
        message, _ = run_main(FakeEvdev([pad]), "--mac", "99:99:99:99:99:99")
        self.assertIn("not found", message)
        self.assertFalse(pad.grabbed)

    def test_a_virtual_pad_that_cannot_be_made_is_explained_and_the_controller_is_left_alone(self):
        pad = FakeDevice("/dev/input/event6")
        error = FakeEvdev.UInputError('"/dev/uinput" cannot be opened for writing')
        message, _ = run_main(FakeEvdev([pad], uinput_error=error), "--device", pad.path)
        self.assertIn("uinput", message)
        self.assertIn("install-udev.sh --uinput", message)
        self.assertFalse(pad.grabbed)

    def test_it_tells_you_the_filter_needs_the_fast_latency_mode(self):
        pad = FakeDevice("/dev/input/event6", batches=[[PRESS, SYN]])
        _, out = run_main(FakeEvdev([pad], stop_after_syns=1), "--device", pad.path)
        self.assertIn("Option + 4K", out)

    def test_a_window_of_zero_is_refused(self):
        message, _ = run_main(FakeEvdev([]), "--window", "0")
        self.assertIn("--window", message)


if __name__ == "__main__":
    unittest.main()
