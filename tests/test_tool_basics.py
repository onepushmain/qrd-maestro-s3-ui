"""Checks that apply to several tools: --help output, and make lint."""
import sys
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from shell_helpers import ROOT, run  # noqa: E402


class Usage(unittest.TestCase):
    def test_help_prints_the_usage_comment_and_none_of_the_code(self):
        for script in ("lightbar.sh", "measure-latency.sh", "install-udev.sh"):
            r = run(script, "--help")
            self.assertEqual(r.returncode, 0, script)
            self.assertIn("Usage:", r.stdout, script)
            for leak in ("set -", "sysfs=", "#"):
                self.assertNotIn(leak, r.stdout, f"{script} --help prints source text: {leak!r}")



class MakeLint(unittest.TestCase):
    @unittest.skipUnless(shutil.which("make"), "make not installed")
    def test_lint_fails_when_shellcheck_finds_a_problem_and_does_not_claim_it_is_missing(self):
        with tempfile.TemporaryDirectory() as bin_dir:
            fake = pathlib.Path(bin_dir, "shellcheck")
            fake.write_text("#!/bin/sh\necho 'SC0000: a problem'\nexit 1\n")
            fake.chmod(0o755)
            e = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}")
            r = subprocess.run(["make", "-C", str(ROOT), "lint"], capture_output=True, text=True, env=e)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("not installed", r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
