# qrd-maestro-s3-ui

A browser dashboard and Linux toolkit for the **QRD Maestro S3** leverless controller.
Everything is read-only unless stated otherwise: nothing here writes to the controller's
firmware or saved settings, so it cannot brick it or change how it behaves on Windows or
PlayStation.

![dashboard](docs/dashboard.png)

## Dashboard

A single page that reads the controller over WebHID in any Chromium browser
(Chrome, Edge, Brave, Helium) on Linux or Windows. No install, no driver.

```
git clone https://github.com/onepushmain/qrd-maestro-s3-ui
cd qrd-maestro-s3-ui
python3 -m http.server 8777        # python -m http.server 8777 on Windows
```
Open <http://localhost:8777>, click **Connect controller**, pick **Wireless Controller**.

What it shows:
- the Maestro S3's own layout, every button lighting as you press it
- **SOCD output**: what the controller sends *after* its own SOCD cleaning, so you can verify the mode
- **report rate and jitter**: live input-timing health, graded FAST / GOOD / OK / SLOW
- **switch health**: counts bounces (double-fires) per button to catch a worn hot-swap switch
- **controller shortcuts**: the button combos from QRD's manual, in one place
- settings: colours, label scheme (PlayStation / arcade / Xbox / 1P–4K), Up-button side, panels

The one write it can do, from Settings, is the standard DualShock lightbar command. On the
Maestro S3 this drives the **indicator LED** only; the button backlights are set on the
controller with **L3 + R3**.

## Findings worth knowing

Full notes in [`re/FINDINGS.md`](re/FINDINGS.md); the short version:

- **The default latency mode is slow.** As shipped, the controller reports at **62 Hz**
  (every 16 ms, about one game frame). After **Option + 4K** it reports at **247 Hz** (4 ms),
  the fastest its USB polling allows. The setting is saved on the controller. Measured with
  `tools/measure-latency.sh`.
- The controller presents itself as a DualShock 4 v2 (`054C:09CC`) running firmware built
  in 2017 on an Actions Semiconductor Bluetooth chip (Zephyr RTOS). The firmware image is
  encrypted, so custom firmware is not a practical option.
- SOCD, turbo, macro, remap and LED settings live only on the controller and are not readable
  or writable over USB. `re/snapshot.py` lets you check this yourself.
- **QRD's official firmware updater download (V1.05) was infected with the XRed worm when
  checked in October 2026.** Hashes and details in [`re/FIRMWARE-PLAN.md`](re/FIRMWARE-PLAN.md).
  Scan anything you download from the vendor before running it.

## Linux tools

| Path | What it does | Needs |
|------|--------------|-------|
| `dist/70-qrd-maestro-s3.rules` | Stable `/dev/input/qrd-maestro-s3` symlink, hides the unused motion/touchpad nodes, grants lightbar + uinput access | `sudo cp` to `/etc/udev/rules.d/`, reload udev |
| `tools/sdl-mapping.sh` | Generates an SDL2 GameControllerDB line for the controller | — |
| `tools/measure-latency.sh` | Ground-truth USB polling rate via usbmon | sudo |
| `tools/debounce.py` | evdev→uinput chatter filter if a switch starts double-firing (runs on the host, firmware untouched) | `python-evdev` |
| `tools/lightbar.sh` | Indicator LED colour via the kernel's LED interface; `battery` mode shows charge level | udev rule or sudo |
| `re/identify.py` | Prints the controller's MAC and firmware build (read-only) | — |
| `re/dump_features.py` | Dumps every HID feature report (read-only) | — |
| `re/snapshot.py` | Snapshot → change a setting on the controller → diff, to see whether a setting is visible over USB | — |

The udev rule matches by USB id, so it also applies to a genuine DualShock 4; that is harmless.
To restrict it to one unit, add its MAC (from `re/identify.py`) as described in the rule file.

## Controller shortcuts (from the manual and firmware 1.05 notes)

| Combo | Function |
|-------|----------|
| Option + Up (2 s) | Cycle SOCD: SOCD1 (Up wins) → SOCD2 (neutral) → SOCD3 (last input) → EZ |
| Option + 4K / 3K / 4P / 2K | Latency: lowest / low / medium / automatic |
| L3 + R3 (2 s) | Button backlights: 8 colours, breathing / colour-changing, off |
| Option + Left / Down / Right (2 s) | Directions act as D-pad / left stick / right stick |
| Turbo + button (2 s) | Assign turbo; hold Turbo 2 s to switch continuous / infinite |
| Option + Share (3 s) | X-Input mode (wired only) |
| Hold Share while off | Bluetooth pairing |

In PlayStation labels: 4P = L1, 2K = ○, 3K = R2, 4K = L2.

## License

MIT
