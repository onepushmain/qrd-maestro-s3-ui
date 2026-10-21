"""Tests for the read-only HID helpers in re/.

Expected values are written out by hand: the feature IDs of the real descriptor come from an
independent walk of the HID item grammar, the pairing report uses made-up MAC addresses, and the
firmware report is the 0xA3 reply a controller really sent."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "re"))
import hidraw  # noqa: E402
import identify  # noqa: E402
import snapshot  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"


class FeatureReportIds(unittest.TestCase):
    def ids(self, *items):
        return hidraw.feature_report_ids(bytes(items))

    def test_real_ds4_descriptor(self):
        descriptor = bytes.fromhex((FIXTURES / "ds4v2-report-descriptor.hex").read_text())
        want = [0x02, 0x04, 0x08, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
                *range(0x80, 0x8A), *range(0x90, 0x95), *range(0xA0, 0xA5), *range(0xA7, 0xB0),
                0xB0, 0xB3, 0xB4, 0xB5, 0xD0, 0xD4, 0xE0, 0xF0, 0xF1, 0xF2]
        self.assertEqual(len(want), 48)
        self.assertEqual(hidraw.feature_report_ids(descriptor), want)

    def test_feature_item_takes_the_report_id_in_force(self):
        self.assertEqual(self.ids(0x85, 0x01, 0x81, 0x02, 0x85, 0x02, 0xB1, 0x02), [2])

    def test_feature_without_a_report_id_is_id_zero(self):
        self.assertEqual(self.ids(0xB1, 0x02), [0])

    def test_input_and_output_items_are_not_features(self):
        self.assertEqual(self.ids(0x85, 0x01, 0x81, 0x02, 0x91, 0x02), [])

    def test_long_item_is_skipped_whole(self):
        # the long item's data happens to contain 0x85 0x09, which must not be read as a Report ID
        self.assertEqual(self.ids(0xFE, 0x02, 0x01, 0x85, 0x09, 0x85, 0x03, 0xB1, 0x02), [3])

    def test_four_byte_item_data_is_skipped_whole(self):
        self.assertEqual(self.ids(0x85, 0x04, 0x27, 0xFF, 0xFF, 0xFF, 0x85, 0xB1, 0x02), [4])

    def test_two_byte_feature_item(self):
        self.assertEqual(self.ids(0x85, 0x06, 0xB2, 0x02, 0x01), [6])

    def test_ids_are_unique_and_sorted(self):
        self.assertEqual(self.ids(0x85, 0x09, 0xB1, 0x02, 0x85, 0x03, 0xB1, 0x02, 0x85, 0x09, 0xB1, 0x02), [3, 9])


class FindDevice(unittest.TestCase):
    def tree(self, root, nodes):
        for name, hid_id in nodes.items():
            d = pathlib.Path(root, "class", "hidraw", name, "device")
            d.mkdir(parents=True)
            (d / "uevent").write_text(f"DRIVER=playstation\nHID_ID={hid_id}\nHID_NAME=x\n")

    def test_finds_the_usb_controller_among_other_devices(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root, {"hidraw1": "0003:0000046D:0000C547", "hidraw3": "0003:0000054C:000009CC"})
            self.assertEqual(hidraw.find_device(sysfs=root), "/dev/hidraw3")

    def test_finds_the_bluetooth_controller(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root, {"hidraw4": "0005:0000054C:000009CC"})
            self.assertEqual(hidraw.find_device(sysfs=root), "/dev/hidraw4")

    def test_raises_a_clear_error_when_there_is_none(self):
        with tempfile.TemporaryDirectory() as root:
            self.tree(root, {"hidraw1": "0003:0000046D:0000C547"})
            with self.assertRaises(hidraw.DeviceNotFound):
                hidraw.find_device(sysfs=root)


class Identify(unittest.TestCase):
    def test_pairing_report_gives_both_macs_most_significant_byte_first(self):
        report = bytes([0x12, 1, 2, 3, 4, 5, 6, 0x08, 0x25, 0x00, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF])
        self.assertEqual(identify.parse_pairing(report), ("06:05:04:03:02:01", "ff:ee:dd:cc:bb:aa"))

    def test_firmware_report_gives_the_build_date_and_time(self):
        report = bytes.fromhex("a34a756e20203920323031370000000000" "31323a33363a3431" + "00" * 9
                               + "0104b401000000" "07a01020" "00a00200")
        self.assertEqual(len(report), 49)
        self.assertEqual(identify.parse_firmware(report), "Jun  9 2017 12:36:41")


class Snapshot(unittest.TestCase):
    def test_diff_lists_each_changed_offset_with_old_and_new_byte(self):
        a = {"81": "00000000", "02": "01"}
        b = {"81": "00000700", "02": "01"}
        self.assertEqual(snapshot.diff_reports(a, b), [("81", [(2, 0x00, 0x07)])])

    def test_identical_snapshots_have_no_diff(self):
        a = {"81": "0102", "02": "ff"}
        self.assertEqual(snapshot.diff_reports(a, dict(a)), [])

    def test_a_longer_report_and_a_new_report_both_show(self):
        a = {"81": "0102"}
        b = {"81": "010203", "0a": "07"}
        self.assertEqual(snapshot.diff_reports(a, b),
                         [("0a", [(0, None, 0x07)]), ("81", [(2, None, 0x03)])])

    def test_snapshot_skips_ids_the_device_rejects(self):
        def get(report_id):
            if report_id == 0x04:
                raise OSError(22, "Invalid argument")
            return bytes([report_id, 0xAB])
        self.assertEqual(snapshot.take_snapshot(get, [0x02, 0x04, 0x12]), {"02": "02ab", "12": "12ab"})

    def test_command_line_diff_shows_the_changed_byte(self):
        with tempfile.TemporaryDirectory() as d:
            pathlib.Path(d, "a.json").write_text(json.dumps({"81": "00000000"}))
            pathlib.Path(d, "b.json").write_text(json.dumps({"81": "00000700"}))
            r = subprocess.run([sys.executable, str(ROOT / "re" / "snapshot.py"), "diff",
                                f"{d}/a.json", f"{d}/b.json"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("0x81", r.stdout)
        self.assertRegex(r.stdout, r"\[\s*2\]\s+00 -> 07")

    def test_command_line_diff_says_when_nothing_changed(self):
        with tempfile.TemporaryDirectory() as d:
            for n in ("a", "b"):
                pathlib.Path(d, f"{n}.json").write_text(json.dumps({"81": "0000"}))
            r = subprocess.run([sys.executable, str(ROOT / "re" / "snapshot.py"), "diff",
                                f"{d}/a.json", f"{d}/b.json"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn("No feature report changed", r.stdout)


if __name__ == "__main__":
    unittest.main()
