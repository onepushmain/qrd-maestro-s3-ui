"""Shared by the shell-tool tests: run a tool, and build the fake sysfs trees it is pointed at."""
import os
import pathlib
import subprocess

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


def add_led_group(root, name, hid_id, uniq=None):
    for channel in ("red", "green", "blue", "global"):
        led = pathlib.Path(root, "class", "leds", f"{name}:{channel}")
        write(led / "brightness", "0\n")
        write(led / "device" / "uevent", f"DRIVER=playstation\nHID_ID={hid_id}\n" + (f"HID_UNIQ={uniq}\n" if uniq else ""))


def add_input(root, event, name, vendor, product, version="8111", uniq="aa:bb:cc:dd:ee:ff", bustype="0003"):
    dev = pathlib.Path(root, "class", "input", event, "device")
    write(dev / "name", name + "\n")
    write(dev / "uniq", uniq + "\n")
    for k, v in (("bustype", bustype), ("vendor", vendor), ("product", product), ("version", version)):
        write(dev / "id" / k, v + "\n")


def brightness(root, name):
    return [int(pathlib.Path(root, "class", "leds", f"{name}:{c}", "brightness").read_text())
            for c in ("red", "green", "blue")]
