# Maestro S3: what we found

Measured on one unit on 2026-10-20, on Linux with the `hid-playstation` driver, using read-only HID requests and
USB captures. Where something comes from QRD's printed manual or its firmware 1.05 notes rather than from a
measurement, it says so. Everything about Bluetooth comes from the DualShock 4 protocol, not from this controller.

## Identity

| | |
|---|---|
| USB id | `054C:09CC`, a Sony DualShock 4 v2 |
| HID descriptor | 507 bytes: input report `0x01`, output report `0x05`, 48 feature reports (a copy is in `tests/fixtures/`) |
| Bluetooth MAC | `re/identify.py` prints it (feature report `0x12`, bytes 1 to 6, least significant byte first). We have seen one unit, and its address looks like a placeholder (a multicast first byte and ascending trailing bytes), so other units may share it |
| Firmware build string | `Jun  9 2017 12:36:41` (feature report `0xA3`). The Maestro S3 was released in 2024, so this is almost certainly a DualShock 4 string the firmware reports, not its own build date |
| Linux | Three evdev nodes (gamepad, motion sensors, touchpad), an LED set and a battery |

## Input report

USB report `0x01`, with the report id already removed (this is what WebHID and `core.js` see), 63 bytes:

| Byte | Content |
|------|---------|
| 0 to 3 | Sticks. There are none, but the direction buttons can be switched to act as the left or right stick (Option + Down or Right) and then arrive here (from the manual and the DualShock 4 layout; we did not switch ours, because that setting is saved on the controller) |
| 4 | Low nibble: d-pad hat, 0 up, 1 up-right, 2 right, 3 right-down, 4 down, 5 down-left, 6 left, 7 left-up, 8 neutral. High nibble: square `0x10`, cross `0x20`, circle `0x40`, triangle `0x80` |
| 5 | L1 `0x01`, R1 `0x02`, L2 `0x04`, R2 `0x08`, Share `0x10`, Options `0x20`, L3 `0x40`, R3 `0x80` |
| 6 | Home `0x01`, touchpad click `0x02`, the top six bits are a frame counter |
| 7, 8 | L2 and R2 as analog values |
| 29 | Battery: low nibble is the level, bit 4 is set while charging |

Over Bluetooth a DualShock 4 first sends a 9-byte report `0x01` with only the first few fields; after a read of
feature report `0x02` it sends report `0x11`, which carries the same fields two bytes later. That is known DualShock 4
behaviour; it was not measured on this controller, and `core.js` handles it with synthetic reports.

In the default D-pad mode the direction buttons arrive as the hat, so what the page sees is the result **after** the
controller's own SOCD cleaning. The Turbo button is handled inside the controller and has no bit in the report.

**Battery.** The kernel reads it as `level * 10 + 5`, capped at 100, and `core.js` does the same. On this unit the
charging bit was set while it charged (55% at the time) and clear while it sat on USB at full charge: the kernel then
reports "100% Discharging", and the page shows 100% without a charging mark.

## Feature reports

The descriptor declares 48 feature reports but only 7 give distinct answers (`re/dump_features.py` groups them):

- `0x02`: motion-sensor calibration, 37 bytes
- `0x12`: pairing info, the controller's MAC and the MAC of the host it is paired with
- `0xA3`: firmware build date and time, plus version words
- `0x81`, `0xF1`, `0xF2`: larger blocks that repeat some of the above; `0xF0` to `0xF2` belong to the PlayStation 4 authentication handshake, which we did not exercise
- every other id (about 40) returns the same filler buffer

## Where the settings live

We saw no trace of the SOCD mode, turbo, macros, remaps, latency mode or LED settings in a dump of these reports, and
we found no configuration software from QRD (the only PC program on its site is the firmware updater). That points to
settings that are kept in the controller and changed with button combinations only.

It is weak evidence: one dump cannot show a setting. `re/snapshot.py` can settle it for any one setting: save, change
that setting on the controller with its combination, save again, and diff. We have not run that diff for any setting yet.
The manual says only the SOCD mode, direction mode, latency mode and turbo are saved on the controller.

## Latency

The same controller on USB (full speed, 12 Mbit/s):

| Mode | Time between reports | Rate | Jitter (standard deviation) | Instrument |
|------|----------------------|------|------------------------------|------------|
| As shipped | 16.0 ms | 62 Hz | 0.39 ms | usbmon, 311 reports in 5 s |
| After setting Option + 4K | 4.05 ms | 247 Hz | 0.44 ms | timing reads of the hidraw node, 989 reports in 4 s |

The endpoint descriptor asks the host to poll every 5 ms. The measured 4 ms matches the way the Linux xHCI driver rounds
full-speed intervals down to a power of two, though we did not confirm that separately. Either way, 247 Hz is the most this
connection delivers, and the default mode sends one report in every four polls.

The two rows were taken with different instruments (usbmon, then timing reads of the hidraw node); both report the same
quantity. `tools/measure-latency.sh --analyze` reproduces the usbmon figures from a saved capture.

**Which combination is which.** The printed manual (February 2024) and the firmware 1.05 notes name the modes differently:

| Combination | Printed manual | Firmware 1.05 notes |
|-------------|----------------|---------------------|
| Option + 2K | Automatic | Automatic |
| Option + 4P | Medium | Medium |
| Option + 4K | "Highest" | "Lowest" |
| Option + 3K | "High" | "Low" |
| Option + 3P | "Low" | "High", removed in 1.05 |

Only Option + 4K was measured here. In the manual's PlayStation names: 2K is ○, 3P is L1, 4P is R1, 3K is L2 and 4K is R2.

## Open questions

- Which of the other latency combinations is actually fastest or slowest. Press one, then watch the report rate.
- Whether any setting shows up in a snapshot diff.
- What drives the button backlights. The updater package also contains Nuvoton ISP tool code (see `FIRMWARE-NOTES.md`),
  which hints at a second microcontroller, but nothing here confirms it.
