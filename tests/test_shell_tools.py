"""Tests for the shell tools, run against fake sysfs trees and recorded input.
Nothing here touches real hardware: every run gets SYSFS pointed at a temporary directory."""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
DS4_V2 = "0003:0000054C:000009CC"
KEYBOARD = "0003:0000046D:0000C31C"


def run(script, *args, env=None, path_prefix=None):
    e = dict(os.environ)
    e.update(env or {})
    if path_prefix:
        e["PATH"] = f"{path_prefix}:{e['PATH']}"
    return subprocess.run([str(TOOLS / script), *args], capture_output=True, text=True, env=e)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def add_led_group(root, name, hid_id):
    for channel in ("red", "green", "blue", "global"):
        led = pathlib.Path(root, "class", "leds", f"{name}:{channel}")
        write(led / "brightness", "0\n")
        write(led / "device" / "uevent", f"DRIVER=playstation\nHID_ID={hid_id}\n")


def add_input(root, event, name, vendor, product, version="8111", uniq="aa:bb:cc:dd:ee:ff"):
    dev = pathlib.Path(root, "class", "input", event, "device")
    write(dev / "name", name + "\n")
    write(dev / "uniq", uniq + "\n")
    for k, v in (("bustype", "0003"), ("vendor", vendor), ("product", product), ("version", version)):
        write(dev / "id" / k, v + "\n")


def brightness(root, name):
    return [int(pathlib.Path(root, "class", "leds", f"{name}:{c}", "brightness").read_text())
            for c in ("red", "green", "blue")]


class Lightbar(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.env = {"SYSFS": self.root}

    def tearDown(self):
        self.tmp.cleanup()

    def test_sets_the_controllers_lightbar_and_leaves_other_leds_alone(self):
        add_led_group(self.root, "input5", DS4_V2)
        add_led_group(self.root, "input6", KEYBOARD)
        r = run("lightbar.sh", "10", "20", "30", env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(brightness(self.root, "input5"), [10, 20, 30])
        self.assertEqual(brightness(self.root, "input6"), [0, 0, 0])

    def test_accepts_the_whole_range_and_leading_zeros(self):
        add_led_group(self.root, "input5", DS4_V2)
        for args, want in ((("255", "0", "255"), [255, 0, 255]), (("08", "09", "010"), [8, 9, 10])):
            r = run("lightbar.sh", *args, env=self.env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertEqual(brightness(self.root, "input5"), want)

    def test_off_turns_every_channel_to_zero(self):
        add_led_group(self.root, "input5", DS4_V2)
        run("lightbar.sh", "255", "255", "255", env=self.env)
        self.assertEqual(run("lightbar.sh", "off", env=self.env).returncode, 0)
        self.assertEqual(brightness(self.root, "input5"), [0, 0, 0])

    def test_battery_colour_follows_the_charge_level(self):
        add_led_group(self.root, "input5", DS4_V2)
        cap = pathlib.Path(self.root, "class", "power_supply", "ps-controller-battery-aa:bb:cc:dd:ee:ff", "capacity")
        for level, want in ((70, [0, 255, 0]), (40, [255, 140, 0]), (10, [255, 0, 0])):
            write(cap, f"{level}\n")
            self.assertEqual(run("lightbar.sh", "battery", env=self.env).returncode, 0)
            self.assertEqual(brightness(self.root, "input5"), want, f"{level}%")

    def test_battery_mode_explains_a_missing_battery(self):
        add_led_group(self.root, "input5", DS4_V2)
        r = run("lightbar.sh", "battery", env=self.env)
        self.assertEqual(r.returncode, 1)
        self.assertIn("battery", r.stderr.lower())

    def test_rejects_values_outside_0_to_255_before_touching_anything(self):
        add_led_group(self.root, "input5", DS4_V2)
        for args in (("256", "0", "0"), ("0", "300", "0"), ("-1", "0", "0"), ("a", "b", "c"), ("1", "2"), ("1", "2", "3", "4")):
            r = run("lightbar.sh", *args, env=self.env)
            self.assertEqual(r.returncode, 2, args)
            self.assertIn("0-255", r.stderr)
        self.assertEqual(brightness(self.root, "input5"), [0, 0, 0])

    def test_reports_when_no_controller_is_present(self):
        add_led_group(self.root, "input6", KEYBOARD)
        r = run("lightbar.sh", "1", "2", "3", env=self.env)
        self.assertEqual(r.returncode, 1)
        self.assertIn("not found", r.stderr)


class SdlMapping(unittest.TestCase):
    def test_guid_matches_the_known_dualshock_4_v2_evdev_guid(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event7", "Sony Interactive Entertainment Wireless Controller", "054c", "09cc")
            add_input(root, "event8", "Logitech USB Receiver", "046d", "c547", version="0111")
            r = run("sdl-mapping.sh", env={"SYSFS": root})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("030000004c050000cc09000011810000,QRD Maestro S3,"), r.stdout)
        self.assertIn("platform:Linux", r.stdout)

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


class InstallUdev(unittest.TestCase):
    MAC = "aa:bb:cc:dd:ee:ff"

    def test_renders_the_rules_for_one_controller_only(self):
        r = run("install-udev.sh", "--mac", "AA:BB:CC:DD:EE:FF", "--print")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("@MAC@", r.stdout)
        self.assertIn(f'ATTRS{{uniq}}=="{self.MAC}"', r.stdout)
        self.assertIn(f"HID_UNIQ={self.MAC}", r.stdout)
        self.assertNotIn("AA:BB", r.stdout)

    def test_does_not_grant_uinput_unless_asked(self):
        plain = run("install-udev.sh", "--mac", self.MAC, "--print").stdout
        with_uinput = run("install-udev.sh", "--mac", self.MAC, "--uinput", "--print").stdout
        self.assertNotIn("uinput", plain)
        self.assertIn('KERNEL=="uinput"', with_uinput)

    def test_rejects_a_malformed_mac(self):
        for bad in ("nonsense", "aa:bb:cc:dd:ee", "aa:bb:cc:dd:ee:gg"):
            r = run("install-udev.sh", "--mac", bad, "--print")
            self.assertEqual(r.returncode, 2, bad)

    def test_finds_the_mac_of_the_connected_controller(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event7", "Sony Interactive Entertainment Wireless Controller", "054c", "09cc", uniq="11:22:33:44:55:66")
            add_input(root, "event8", "Logitech USB Receiver", "046d", "c547", uniq="")
            r = run("install-udev.sh", "--print", env={"SYSFS": root})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('ATTRS{uniq}=="11:22:33:44:55:66"', r.stdout)

    def test_asks_for_a_mac_when_two_controllers_are_connected(self):
        with tempfile.TemporaryDirectory() as root:
            for ev, mac in (("event7", "11:22:33:44:55:66"), ("event9", "66:55:44:33:22:11")):
                add_input(root, ev, "Sony Interactive Entertainment Wireless Controller", "054c", "09cc", uniq=mac)
            r = run("install-udev.sh", "--print", env={"SYSFS": root})
        self.assertEqual(r.returncode, 2)
        self.assertIn("--mac", r.stderr)

    def test_says_so_when_no_controller_is_connected(self):
        with tempfile.TemporaryDirectory() as root:
            r = run("install-udev.sh", "--print", env={"SYSFS": root})
        self.assertEqual(r.returncode, 1)
        self.assertIn("No Maestro S3", r.stderr)

    def test_printing_never_calls_sudo(self):
        with tempfile.TemporaryDirectory() as bin_dir:
            marker = pathlib.Path(bin_dir, "sudo-was-called")
            sudo = pathlib.Path(bin_dir, "sudo")
            sudo.write_text(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
            sudo.chmod(0o755)
            run("install-udev.sh", "--mac", self.MAC, "--uinput", "--print", path_prefix=bin_dir)
            self.assertFalse(marker.exists())

    @unittest.skipUnless(
        shutil.which("udevadm") and subprocess.run(["udevadm", "verify", "--help"], capture_output=True).returncode == 0,
        "this udevadm has no `verify` command")
    def test_rendered_rules_pass_udevadm_verify(self):
        rules = run("install-udev.sh", "--mac", self.MAC, "--uinput", "--print").stdout
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d, "70-test.rules")
            path.write_text(rules)
            r = subprocess.run(["udevadm", "verify", str(path)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
