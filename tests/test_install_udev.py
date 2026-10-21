"""Tests for tools/install-udev.sh and the rules it renders."""
import sys
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from shell_helpers import run, add_input  # noqa: E402


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

    def test_finds_a_controller_that_bluetooth_names_plainly(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event7", "Wireless Controller", "054c", "09cc", uniq="11:22:33:44:55:66", bustype="0005")
            r = run("install-udev.sh", "--print", env={"SYSFS": root})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('ATTRS{uniq}=="11:22:33:44:55:66"', r.stdout)

    def test_does_not_take_a_mac_from_sensor_nodes_or_other_pads(self):
        with tempfile.TemporaryDirectory() as root:
            add_input(root, "event7", "Sony Interactive Entertainment Wireless Controller Motion Sensors", "054c", "09cc", uniq="11:22:33:44:55:66")
            add_input(root, "event8", "Wireless Controller", "054c", "05c4", uniq="66:55:44:33:22:11")
            r = run("install-udev.sh", "--print", env={"SYSFS": root})
        self.assertEqual(r.returncode, 1)
        self.assertIn("No Maestro S3", r.stderr)

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

    @unittest.skipIf(os.geteuid() == 0, "as root the installer never calls sudo, so there is nothing to check")
    def test_printing_never_calls_sudo(self):
        with tempfile.TemporaryDirectory() as bin_dir:
            marker = pathlib.Path(bin_dir, "sudo-was-called")
            sudo = pathlib.Path(bin_dir, "sudo")
            sudo.write_text(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
            sudo.chmod(0o755)
            run("install-udev.sh", "--mac", self.MAC, "--uinput", "--print", path_prefix=bin_dir)
            self.assertFalse(marker.exists())

    def test_asking_to_print_and_remove_together_is_refused_before_anything_runs(self):
        with tempfile.TemporaryDirectory() as bin_dir:
            marker = pathlib.Path(bin_dir, "sudo-was-called")
            sudo = pathlib.Path(bin_dir, "sudo")
            sudo.write_text(f"#!/bin/sh\ntouch {marker}\nexit 1\n")
            sudo.chmod(0o755)
            for order in (("--print", "--remove"), ("--remove", "--print")):
                r = run("install-udev.sh", *order, "--mac", self.MAC, path_prefix=bin_dir)
                self.assertEqual(r.returncode, 2, order)
                self.assertIn("not both", r.stderr)
            self.assertFalse(marker.exists())

    def rendered_rules(self, *extra):
        return run("install-udev.sh", "--mac", self.MAC, "--print", *extra).stdout

    @staticmethod
    def logical_lines(rules):
        return [line.strip() for line in re.sub(r"\\\n\s*", " ", rules).splitlines() if line.strip() and not line.lstrip().startswith("#")]

    def test_every_rule_but_hidraw_read_access_is_keyed_to_this_controller(self):
        for line in self.logical_lines(self.rendered_rules()):
            if 'SUBSYSTEM=="hidraw"' in line and 'TAG+="uaccess"' in line and "SYMLINK" not in line:
                continue   # read access for the browser: deliberately not keyed, because the MAC is learned late
            self.assertIn(self.MAC, line)

    def hidraw_name_command(self, uevent):
        for line in self.logical_lines(self.rendered_rules()):
            if 'SUBSYSTEM=="hidraw"' in line and "SYMLINK" in line:
                command = re.search(r'PROGRAM="((?:[^"\\]|\\.)*)"', line).group(1)
                return shlex.split(command.replace("/sys%p/../../uevent", str(uevent)))
        raise AssertionError("no rule names the hidraw node")

    def test_the_hidraw_name_waits_for_the_driver_to_learn_the_mac(self):
        # hid-playstation creates the hidraw node first and sets the MAC a few tens of milliseconds later
        with tempfile.TemporaryDirectory() as d:
            uevent = pathlib.Path(d, "uevent")
            uevent.write_text("DRIVER=playstation\nHID_ID=0003:0000054C:000009CC\n")
            threading.Timer(0.35, lambda: uevent.write_text(uevent.read_text() + f"HID_UNIQ={self.MAC}\n")).start()
            started = time.monotonic()
            r = subprocess.run(self.hidraw_name_command(uevent), capture_output=True, timeout=10)
            waited = time.monotonic() - started
        self.assertEqual(r.returncode, 0)
        self.assertTrue(0.3 <= waited < 2.0, waited)

    def test_the_hidraw_name_is_not_given_to_another_controller_and_does_not_wait_forever(self):
        with tempfile.TemporaryDirectory() as d:
            uevent = pathlib.Path(d, "uevent")
            uevent.write_text("HID_ID=0003:0000054C:000009CC\nHID_UNIQ=11:22:33:44:55:66\n")
            started = time.monotonic()
            r = subprocess.run(self.hidraw_name_command(uevent), capture_output=True, timeout=10)
        self.assertEqual(r.returncode, 1)
        self.assertLess(time.monotonic() - started, 3.0)

    def test_the_hidraw_name_is_immediate_when_the_mac_is_already_known(self):
        with tempfile.TemporaryDirectory() as d:
            uevent = pathlib.Path(d, "uevent")
            uevent.write_text(f"HID_UNIQ={self.MAC}\n")
            started = time.monotonic()
            r = subprocess.run(self.hidraw_name_command(uevent), capture_output=True, timeout=10)
        self.assertEqual(r.returncode, 0)
        self.assertLess(time.monotonic() - started, 0.3)

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



@unittest.skipIf(os.geteuid() == 0, "as root the installer would not use the stand-in for sudo")
class InstallUdevCommands(unittest.TestCase):
    """Runs the installer with a stand-in for sudo that only records what it was asked to do."""
    MAC = "aa:bb:cc:dd:ee:ff"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bin = pathlib.Path(self.tmp.name, "bin")
        self.bin.mkdir()
        self.log = pathlib.Path(self.tmp.name, "sudo.log")
        sudo = self.bin / "sudo"
        sudo.write_text(f'#!/bin/sh\necho "$@" >> {self.log}\nexit 0\n')
        sudo.chmod(0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def go(self, *args, env=None):
        return run("install-udev.sh", "--mac", self.MAC, *args, env=env, path_prefix=str(self.bin))

    def calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_install_writes_the_main_rules_and_reloads_udev(self):
        r = self.go()
        self.assertEqual(r.returncode, 0, r.stderr)
        calls = self.calls()
        self.assertTrue(any(c.startswith("install -m 0644 ") and c.endswith(" /etc/udev/rules.d/70-qrd-maestro-s3.rules") for c in calls), calls)
        self.assertIn("udevadm control --reload", calls)
        self.assertFalse(any("uinput" in c for c in calls), calls)   # nothing about uinput unless asked

    def test_uinput_installs_its_rule_and_applies_it_to_the_device_node(self):
        r = self.go("--uinput")
        self.assertEqual(r.returncode, 0, r.stderr)
        calls = self.calls()
        self.assertTrue(any(c.endswith(" /etc/udev/rules.d/71-qrd-maestro-s3-uinput.rules") for c in calls), calls)
        # /dev/uinput is not an input, hidraw or leds device, so the main trigger never reaches it
        self.assertTrue(any(c.startswith("udevadm trigger") and "--name-match=/dev/uinput" in c for c in calls), calls)

    def test_uinput_says_what_it_allows_and_to_load_the_module_when_the_node_is_missing(self):
        r = self.go("--uinput", env={"UINPUT_NODE": os.path.join(self.tmp.name, "no-such-uinput")})
        self.assertIn("modprobe uinput", r.stdout)
        self.assertIn("inject", r.stdout)

    def test_remove_deletes_both_files_reloads_and_says_what_stays_open(self):
        r = self.go("--remove")
        self.assertEqual(r.returncode, 0, r.stderr)
        calls = self.calls()
        self.assertIn("rm -f /etc/udev/rules.d/70-qrd-maestro-s3.rules /etc/udev/rules.d/71-qrd-maestro-s3-uinput.rules", calls)
        self.assertIn("udevadm control --reload", calls)
        self.assertIn("reconnected", r.stdout)

    def test_the_closing_advice_names_the_command_that_works_after_a_fresh_plug(self):
        r = self.go()
        self.assertIn("sudo udevadm trigger --subsystem-match=hidraw", r.stdout)


if __name__ == "__main__":
    unittest.main()
