"""Tests for tools/lightbar.sh, run against fake sysfs trees. Nothing here touches real hardware."""
import sys
import pathlib
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from shell_helpers import DS4_V2, KEYBOARD, run, write, add_led_group, brightness  # noqa: E402


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

    def test_rejects_numbers_too_long_to_be_a_colour_value(self):
        add_led_group(self.root, "input5", DS4_V2)
        for big in ("18446744073709551616", "9223372036854775808", "0256", "1000"):
            r = run("lightbar.sh", big, "0", "0", env=self.env)
            self.assertEqual(r.returncode, 2, big)
        self.assertEqual(brightness(self.root, "input5"), [0, 0, 0])

    def test_mac_option_chooses_one_of_two_controllers(self):
        add_led_group(self.root, "input5", DS4_V2, uniq="aa:bb:cc:dd:ee:ff")
        add_led_group(self.root, "input6", DS4_V2, uniq="11:22:33:44:55:66")
        r = run("lightbar.sh", "--mac", "11:22:33:44:55:66", "1", "2", "3", env=self.env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(brightness(self.root, "input6"), [1, 2, 3])
        self.assertEqual(brightness(self.root, "input5"), [0, 0, 0])

    def test_mac_option_for_a_controller_that_is_not_there_says_so(self):
        add_led_group(self.root, "input5", DS4_V2, uniq="aa:bb:cc:dd:ee:ff")
        r = run("lightbar.sh", "--mac", "99:99:99:99:99:99", "1", "2", "3", env=self.env)
        self.assertEqual(r.returncode, 1)
        self.assertIn("not found", r.stderr)
        self.assertEqual(brightness(self.root, "input5"), [0, 0, 0])

    def test_off_turns_every_channel_to_zero(self):
        add_led_group(self.root, "input5", DS4_V2)
        run("lightbar.sh", "255", "255", "255", env=self.env)
        self.assertEqual(run("lightbar.sh", "off", env=self.env).returncode, 0)
        self.assertEqual(brightness(self.root, "input5"), [0, 0, 0])

    def test_battery_colour_follows_the_charge_level(self):
        add_led_group(self.root, "input5", DS4_V2, uniq="aa:bb:cc:dd:ee:ff")
        cap = pathlib.Path(self.root, "class", "power_supply", "ps-controller-battery-aa:bb:cc:dd:ee:ff", "capacity")
        for level, want in ((70, [0, 255, 0]), (40, [255, 140, 0]), (10, [255, 0, 0])):
            write(cap, f"{level}\n")
            self.assertEqual(run("lightbar.sh", "battery", env=self.env).returncode, 0)
            self.assertEqual(brightness(self.root, "input5"), want, f"{level}%")

    def test_battery_colour_uses_this_controllers_battery_not_another_pads(self):
        add_led_group(self.root, "input5", DS4_V2, uniq="aa:bb:cc:dd:ee:ff")
        for mac, level in (("11:22:33:44:55:66", 10), ("aa:bb:cc:dd:ee:ff", 70)):   # the other pad sorts first
            write(pathlib.Path(self.root, "class", "power_supply", f"ps-controller-battery-{mac}", "capacity"), f"{level}\n")
        self.assertEqual(run("lightbar.sh", "battery", env=self.env).returncode, 0)
        self.assertEqual(brightness(self.root, "input5"), [0, 255, 0])

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


if __name__ == "__main__":
    unittest.main()
