# Maestro S3 — reverse-engineering findings

Measured on one unit (firmware build Jun 9 2017) on 2026-10-20.

All data gathered read-only (HID GET_FEATURE + descriptor parsing) over USB.

## Identity
| Field | Value | Source |
|-------|-------|--------|
| USB ID | `054C:09CC` (presents as DualShock 4 v2) | descriptor |
| Controller BT MAC | `xx:xx:xx:xx:xx:xx` (per unit; see `re/identify.py`) | feature `0x12`, bytes 1–6 reversed |
| Paired host MAC | (this PC's Bluetooth adapter; value omitted) | feature `0x12`, bytes 10–15 reversed |
| Firmware build | `Jun 9 2017 12:36:41` | feature `0xa3`, ASCII |
| Kernel driver | `hid-playstation` → js0, event20 (pad), event21 (motion), event22 (touchpad) | sysfs |
| Lightbar | `/sys/class/leds/inputNN:{red,green,blue}` | sysfs |

## Input report (`0x01` USB / `0x11` Bluetooth, +2 byte offset on BT)
Standard DS4 layout. Directions arrive as the **hat** in the low nibble of byte 4
(0=Up … 7=Up-Left, 8=Neutral) — i.e. *after* the firmware's SOCD cleaning.
Face buttons in the high nibble of byte 4, shoulders/system in bytes 5–6, battery in byte 29
(low nibble = level 0–10, bit 4 = cable).

## Feature reports
The descriptor declares 48 feature IDs. Only a few carry distinct data:
- `0x02` — IMU calibration (37 bytes)
- `0x12` — MAC pairing info
- `0x81` — composite (MAC + firmware strings + calibration)
- `0xa3` — firmware build date/time + version words
- `0xf0`–`0xf2` — PS4 authentication challenge/response block

Most other IDs (`0x04`, `0x08`, `0x10`…`0xa0`) return the **same 256-byte buffer**,
which looks like the firmware answering unimplemented IDs with a shared scratch buffer.

## Conclusion for a Linux configurator
No feature report holds an obvious SOCD / turbo / macro / remap / latency field.
The Maestro's own settings appear to live only in on-device flash, changed by button combos.

**Next step (read-only):** use `re/snapshot.py` to save all reports, change exactly one
setting with its combo, save again, and diff. If a byte moves, that is the config field.
If nothing moves for every setting, the config is not reachable over HID and a native
configurator would need a capture of QRD's own Windows tool talking to the controller
(Wireshark + USBPcap on Windows). Writing config stays off the table until then.

## Latency modes (measured 2026-10-20, USB)
| Mode | Interval | Rate | Jitter |
|------|----------|------|--------|
| Default (as shipped) | 16.0 ms | 62 Hz | 0.39 ms |
| Lowest — Option + 4K (L2) | 4.0 ms | 247 Hz | 0.44 ms |

The USB endpoint requests 5 ms polling; lowest mode is the only one that uses it fully.
Measured with tools/measure-latency.sh (usbmon) and a direct hidraw read timing.

## Firmware image (static analysis of QRD's updater, 2026-10-20)
Actions Semiconductor ADFU toolkit (VID 10D6), `ACTIONSFW`/`FMT001` container with
MBREC.BIN / ZEPHYR.BIN (Zephyr RTOS app) / PARAM.BIN / NVRAM.BIN partitions. Partition
bodies are encrypted (high entropy, SdkCrypt/CryptoEx in the tool). Patching is not feasible
without keys; custom firmware is off the table. Decision: keep stock firmware.
