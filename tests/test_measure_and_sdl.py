"""Tests for tools/measure-latency.sh (against recorded usbmon text) and tools/sdl-mapping.sh (fake sysfs)."""
import sys
import pathlib
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from shell_helpers import run, add_input  # noqa: E402


class SdlMapping(unittest.TestCase):
    def test_guid_matches_the_known_dualshock_4_v2_evdev_guid(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event7", "Sony Interactive Entertainment Wireless Controller", "054c", "09cc")
            add_input(root, "event8", "Logitech USB Receiver", "046d", "c547", version="0111")
            r = run("sdl-mapping.sh", env={"SYSFS": root})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("030000004c050000cc09000011810000,QRD Maestro S3,"), r.stdout)
        self.assertIn("platform:Linux", r.stdout)

    def test_finds_the_controller_when_bluetooth_names_it_plainly(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event7", "Wireless Controller", "054c", "09cc", bustype="0005")
            r = run("sdl-mapping.sh", env={"SYSFS": root})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("05000000"), r.stdout)   # bus 0005 is Bluetooth

    def test_ignores_sensor_and_touchpad_nodes_and_other_pads(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event7", "Sony Interactive Entertainment Wireless Controller Motion Sensors", "054c", "09cc")
            add_input(root, "event8", "Sony Interactive Entertainment Wireless Controller Touchpad", "054c", "09cc")
            add_input(root, "event9", "Wireless Controller", "054c", "05c4")   # a DualShock 4 v1
            r = run("sdl-mapping.sh", env={"SYSFS": root})
        self.assertEqual(r.returncode, 1)

    def test_reports_when_the_controller_is_not_connected(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event8", "Logitech USB Receiver", "046d", "c547")
            r = run("sdl-mapping.sh", env={"SYSFS": root})
        self.assertEqual(r.returncode, 1)
        self.assertIn("not connected", r.stderr)



class MeasureLatency(unittest.TestCase):
    def capture(self, directory, interval_us, count=100):
        lines = []
        for i in range(count):
            t = 1_000_000 + i * interval_us
            lines.append(f"ffff8881 {t - 50} S Ii:5:002:2 -115:4 64 <")          # submission, not counted
            lines.append(f"ffff8881 {t} C Ii:5:002:2 0:4 63 = 01808080")          # the controller's report
            lines.append(f"ffff8882 {t + 7} C Ii:5:003:1 0:8 8 = 00000000")       # another device
            if i % 10 == 0:                                                       # a quieter endpoint on the same device
                lines.append(f"ffff8883 {t + 9} C Ii:5:002:1 0:8 8 = 00000000")
        path = pathlib.Path(directory, "capture.txt")
        path.write_text("\n".join(lines) + "\n")
        return str(path)

    def test_reads_rate_and_jitter_from_a_usbmon_capture(self):
        with tempfile.TemporaryDirectory() as d:
            r = run("measure-latency.sh", "--analyze", self.capture(d, 4000), "5", "2")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("reports: 100", r.stdout)
        self.assertIn("mean interval: 4.000 ms  (250 Hz)", r.stdout)
        self.assertIn("jitter (sd): 0.000 ms", r.stdout)

    def test_bus_and_device_may_be_zero_padded_the_way_lsusb_prints_them(self):
        with tempfile.TemporaryDirectory() as d:
            r = run("measure-latency.sh", "--analyze", self.capture(d, 4000), "05", "02")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("mean interval: 4.000 ms", r.stdout)

    def test_a_bus_number_without_a_device_number_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            r = run("measure-latency.sh", "--analyze", self.capture(d, 4000), "5")
        self.assertEqual(r.returncode, 2)

    def test_a_slower_capture_reads_slower(self):
        with tempfile.TemporaryDirectory() as d:
            r = run("measure-latency.sh", "--analyze", self.capture(d, 16000), "5", "2")
        self.assertIn("mean interval: 16.000 ms  (62 Hz)", r.stdout)

    def test_an_empty_capture_is_an_error(self):
        with tempfile.TemporaryDirectory() as d:
            p = pathlib.Path(d, "empty.txt")
            p.write_text("ffff8882 1 C Ii:5:003:1 0:8 8 = 00\n")
            r = run("measure-latency.sh", "--analyze", str(p), "5", "2")
        self.assertEqual(r.returncode, 1)
        self.assertIn("No reports captured", r.stdout + r.stderr)

    def test_rejects_a_bad_duration(self):
        for bad in ("abc", "0", "-3"):
            r = run("measure-latency.sh", bad)
            self.assertEqual(r.returncode, 2, bad)
            self.assertIn("seconds", r.stderr)


if __name__ == "__main__":
    unittest.main()
