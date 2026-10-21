"""Tests for the chatter filter's decision logic (tools/debounce_core.py).

The contract: contact bounce is swallowed, a real fast tap still arrives, and an input can
never be left stuck in the wrong state."""
import pathlib
import random
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from debounce_core import Debouncer  # noqa: E402

W = 0.008   # 8 ms hold-back window


def run(events, window=W):
    """Replay (time, key, value) events the way the filter's loop does; return (emit_time, key, value)."""
    d, out, spins = Debouncer(window), [], 0

    def settle(until):
        nonlocal spins
        while (deadline := d.next_deadline()) is not None and (until is None or deadline <= until):
            spins += 1
            assert spins < 1000, "the debouncer keeps reporting a deadline it never clears"
            out.extend((deadline, k, v) for k, v in d.due(deadline))

    for t, key, value in events:
        settle(t)
        out.extend((t, k, v) for k, v in d.change(key, value, t))
    settle(None)
    return out


class Debounce(unittest.TestCase):
    def test_a_clean_press_and_release_pass_straight_through(self):
        d = Debouncer(W)
        self.assertEqual(d.change("a", 1, 0.000), [("a", 1)])
        self.assertEqual(d.change("a", 0, 0.100), [("a", 0)])
        self.assertIsNone(d.next_deadline())

    def test_contact_bounce_after_a_press_is_swallowed(self):
        out = run([(0.000, "a", 1), (0.002, "a", 0), (0.004, "a", 1)])
        self.assertEqual([(k, v) for _, k, v in out], [("a", 1)])

    def test_contact_bounce_after_a_release_is_swallowed(self):
        out = run([(0.000, "a", 1), (0.100, "a", 0), (0.102, "a", 1), (0.104, "a", 0)])
        self.assertEqual([(k, v) for _, k, v in out], [("a", 1), ("a", 0)])

    def test_a_tap_faster_than_the_window_is_released_when_the_window_ends(self):
        d = Debouncer(W)
        self.assertEqual(d.change("a", 1, 0.000), [("a", 1)])
        self.assertEqual(d.change("a", 0, 0.003), [])        # held back
        self.assertEqual(d.next_deadline(), W)
        self.assertEqual(d.due(0.0079), [])                  # window still open
        self.assertEqual(d.due(0.0081), [("a", 0)])          # released: never stuck down
        self.assertIsNone(d.next_deadline())

    def test_returning_to_the_forwarded_state_cancels_the_hold(self):
        d = Debouncer(W)
        d.change("a", 1, 0.000)
        d.change("a", 0, 0.002)
        d.change("a", 1, 0.004)
        self.assertIsNone(d.next_deadline())
        self.assertEqual(d.due(1.0), [])

    def test_inputs_do_not_delay_each_other(self):
        d = Debouncer(W)
        d.change("a", 1, 0.000)
        d.change("a", 0, 0.002)                              # a is held back
        self.assertEqual(d.change("b", 1, 0.003), [("b", 1)])

    def test_hat_axis_values_work_like_buttons(self):
        hat = ("abs", 16)                                    # ABS_HAT0X: -1 left, 0 centre, 1 right
        out = run([(0.000, hat, -1), (0.002, hat, 0), (0.004, hat, -1), (0.200, hat, 0)])
        self.assertEqual([(k, v) for _, k, v in out], [(hat, -1), (hat, 0)])

    def test_the_next_deadline_is_the_earliest_hold(self):
        d = Debouncer(W)
        d.change("a", 1, 0.000)
        d.change("b", 1, 0.001)
        d.change("a", 0, 0.002)                              # a held until 0.008
        d.change("b", 0, 0.003)                              # b held until 0.009
        self.assertEqual(d.next_deadline(), W)
        self.assertEqual(d.due(W), [("a", 0)])
        second = d.next_deadline()
        self.assertAlmostEqual(second, 0.009)
        self.assertEqual(d.due(second), [("b", 0)])

    def test_a_first_event_equal_to_the_resting_state_is_ignored(self):
        self.assertEqual(Debouncer(W).change("a", 0, 0.0), [])

    def test_random_chatter_never_leaves_an_input_stuck_or_double_fires(self):
        rng = random.Random(1234)
        for _ in range(300):
            t, events = 0.0, []
            for _ in range(rng.randint(1, 14)):
                t += rng.choice([0.0005, 0.002, 0.004, 0.009, 0.05])
                events.append((t, "k", rng.randint(0, 1)))
            out = run(events)
            forwarded, previous, last_time = [v for _, _, v in out], 0, None
            for emit_time, _, v in out:
                self.assertNotEqual(v, previous, f"repeated {v} in {events}")
                if last_time is not None:
                    self.assertGreaterEqual(emit_time - last_time, W - 1e-9, f"too close in {events}")
                previous, last_time = v, emit_time
            self.assertEqual(previous, events[-1][2], f"stuck in {previous}, real state {events[-1][2]}: {events}")
            self.assertEqual(len(forwarded), len(out))


import debounce_core as core

EV_SYN, EV_KEY, EV_ABS = 0, 1, 3     # linux/input-event-codes.h
BTN_SOUTH, ABS_X, ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y = 0x130, 0x00, 0x02, 0x05, 0x10, 0x11


class FilterRouting(unittest.TestCase):
    """What gets written to the virtual pad, packet by packet."""

    def test_a_tap_shorter_than_the_window_is_released_in_a_packet_of_its_own(self):
        f = core.Filter(W)
        self.assertEqual(f.feed(EV_KEY, BTN_SOUTH, 1, 0.0) + f.feed(EV_SYN, 0, 0, 0.0),
                         [("event", EV_KEY, BTN_SOUTH, 1), ("syn",)])
        self.assertEqual(f.feed(EV_KEY, BTN_SOUTH, 0, 0.003) + f.feed(EV_SYN, 0, 0, 0.003), [])
        self.assertEqual(f.due(0.009), [("event", EV_KEY, BTN_SOUTH, 0), ("syn",)])

    def test_a_release_that_comes_due_while_other_events_arrive_still_gets_its_syn(self):
        f = core.Filter(W)
        f.feed(EV_KEY, BTN_SOUTH, 1, 0.0)
        f.feed(EV_SYN, 0, 0, 0.0)
        f.feed(EV_KEY, BTN_SOUTH, 0, 0.003)                       # held back
        busy = f.feed(EV_ABS, ABS_X, 130, 0.0085)                 # another axis moves; its SYN has not arrived yet
        out = busy + f.due(0.0085)
        self.assertIn(("event", EV_KEY, BTN_SOUTH, 0), out)
        self.assertEqual(out[-1], ("syn",))

    def test_other_events_pass_through_and_each_packet_ends_with_one_syn(self):
        f = core.Filter(W)
        self.assertEqual(f.feed(EV_ABS, ABS_X, 130, 0.0), [("event", EV_ABS, ABS_X, 130)])
        self.assertEqual(f.feed(EV_ABS, ABS_X, 131, 0.001), [("event", EV_ABS, ABS_X, 131)])   # a stick is never held back
        self.assertEqual(f.feed(EV_SYN, 0, 0, 0.001), [("syn",)])
        self.assertEqual(f.feed(EV_SYN, 0, 0, 0.1), [])           # nothing written since: no empty packet

    def test_hat_and_trigger_axes_are_debounced_like_buttons(self):
        for code in (ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y):
            f = core.Filter(W)
            f.feed(EV_ABS, code, 255, 0.0)
            f.feed(EV_SYN, 0, 0, 0.0)
            self.assertEqual(f.feed(EV_ABS, code, 0, 0.002), [], code)      # chatter is held back
            self.assertEqual(f.feed(EV_ABS, code, 255, 0.004), [], code)    # back to the forwarded value: dropped
            self.assertEqual(f.due(1.0), [], code)

    def test_key_repeat_is_not_a_switch_change(self):
        self.assertEqual(core.Filter(W).feed(EV_KEY, BTN_SOUTH, 2, 0.0), [("event", EV_KEY, BTN_SOUTH, 2)])

    def test_it_counts_the_changes_it_swallowed(self):
        f = core.Filter(W)
        for t, v in ((0.000, 1), (0.002, 0), (0.004, 1), (0.100, 0)):
            f.feed(EV_KEY, BTN_SOUTH, v, t)
            f.due(t)
        f.due(1.0)
        self.assertEqual((f.seen, f.forwarded), (4, 2))


class WhichDeviceIsTheController(unittest.TestCase):
    def test_the_usb_and_the_bluetooth_node_names_both_match(self):
        for name in ("Sony Interactive Entertainment Wireless Controller", "Wireless Controller"):
            self.assertTrue(core.is_maestro(name, 0x054C, 0x09CC), name)

    def test_the_motion_sensor_and_touchpad_nodes_do_not(self):
        for name in ("Sony Interactive Entertainment Wireless Controller Motion Sensors",
                     "Sony Interactive Entertainment Wireless Controller Touchpad", "Wireless Controller Touchpad"):
            self.assertFalse(core.is_maestro(name, 0x054C, 0x09CC), name)

    def test_other_pads_and_other_makers_do_not(self):
        self.assertFalse(core.is_maestro("Wireless Controller", 0x054C, 0x05C4))   # DualShock 4 v1
        self.assertFalse(core.is_maestro("DualSense Wireless Controller", 0x054C, 0x0CE6))
        self.assertFalse(core.is_maestro("Wireless Controller", 0x046D, 0x09CC))


class CommandLine(unittest.TestCase):
    def test_help_works_without_python_evdev_loaded(self):
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "debounce.py"), "--help"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("--window", r.stdout)


if __name__ == "__main__":
    unittest.main()
