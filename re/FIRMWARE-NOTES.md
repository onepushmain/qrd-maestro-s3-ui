# Maestro S3 firmware notes

Static analysis of QRD's firmware updater package, 2026-10-20. Nothing was run on the controller, and nothing was flashed.

## Summary

- The controller appears to be built on an **Actions Semiconductor** chip (judging by the update tool's drivers and file names)
  that runs the **Zephyr RTOS** (judging by a `ZEPHYR.BIN` entry in the firmware container's file table).
- The firmware image looks **obfuscated or encrypted**. We looked no further than that.
- **No custom firmware was attempted, and none is planned.** The only thing it would add is control of the button
  backlights from a PC, and the stock firmware already sets those with L3 + R3.
- **The V1.05 updater download that we fetched contained indicators matching the XRed worm.** See the advisory below.

## What the updater package says about the hardware

The updater is a self-extracting archive wrapped around Actions Semiconductor's standard upgrade toolkit:

- A USB driver for Actions' firmware-upgrade mode, **ADFU** (`Driver/AdfuWinUsb.inf`, USB ids `10D6:10D6`, `10D6:FF76`, `10D6:FE02`; `10D6` is Actions Semiconductor's vendor id).
- Actions' production-tool components (`ATT.dll`, `fwsp.pyd`, `CryptoEx.pyd`, `SdkCrypt.dll`, `AdfuInstall.exe`, and others).
- A firmware container tagged `ACTIONSFW` / `FMT001` whose file table lists `MBREC.BIN`, `ZEPHYR.BIN`, `PARAM.BIN`, `NVRAM.BIN` and Actions' tooling files.
- QRD's own instructions: hold **2P** while plugging in USB to enter the update mode.

The container's headers and file names are readable, but the payload had no readable code or strings. We did not try to
decode it. The inner program also contains code from Nuvoton's NuvoISP tool (`NUC1312AE`, `M051` strings), which could
mean a second microcontroller (for example for the LEDs or the button matrix) or just reused tooling. We cannot tell.

## Why not custom firmware

- Flashing is the one action here that can brick the controller.
- The image is not readable, so changing it would first mean getting past whatever protects it.
- What the stock firmware does (Bluetooth, PlayStation authentication, SOCD, latency modes, every platform) would all have to be preserved or rebuilt.

If someone wants to go further, the safe first steps are all read-only: open the case and read the chip markings,
look for an FCC or Bluetooth SIG filing, and check whether the ADFU mode lives in the chip's ROM.

## Advisory: QRD's V1.05 firmware updater

When fetched on 2026-10-20, the file linked from QRD's firmware update page for V1.05 contained indicators matching
the **XRed** worm (also called "Synaptics"), a Windows backdoor that public analyses describe as including a keylogger
and spreading through USB drives and Excel files.

| File | SHA-256 |
|------|---------|
| `Firmware-Update-Tool-for-Maestro-S3-V1-05-1.zip` | `3772450897c505b645a5823a1bab509d7a6b0c2d7d35a0327d1d0e32ce4665ee` |
| `Firmware-Update-Tool-for-Maestro-S3-V1-05-1.exe` (inside the zip) | `8e8f5b68e30c49932687c7e0d76204027f7d033d50585a9ca5998ab83ce01ae9` |

What was found in the outer program (strings and embedded resources, no execution):

- Update and payload addresses `xred.site50.net/syn/SUpdate.ini`, `.../Synaptics.rar` and `.../SSLLibrary.dll`, plus Dropbox links.
- The names `Synaptics.exe`, "Synaptics Pointing Device Driver" and `Synaptics2X`.
- An embedded executable named `KBHKS` (a keyboard hook, by its name) and an embedded Excel macro workbook (`XLSM`).
- `smtp.gmail.com`, and the `._cache_` prefix XRed uses for files it has wrapped.
- The real QRD updater is stored as a resource inside this wrapper. The inner updater executable did not contain these strings.

Public sandbox reports of XRed samples list the same payload addresses and the `Synaptics2X` name, for example
[Joe Sandbox 1739464](https://www.joesandbox.com/analysis/1739464/0/html) and [Tria.ge 241106-rxmbsssamd](https://tria.ge/241106-rxmbsssamd).

**Limits.** This is static analysis. We did not run the file in a sandbox and did not submit it to antivirus engines, and
QRD may have replaced the download since. Compare the hashes above with the file you have, or look the hash up on a
scanning service, before drawing a conclusion. A different hash does not make your copy clean: the file may have been
replaced, or altered. The two sandbox reports above refused automated clients (HTTP 403 and 401) when we checked, so open
them in a browser.

**If you have run it on Windows,** run a full antivirus scan and look for a `Synaptics` folder under `C:\ProgramData`, a
`Synaptics` startup entry, and unexpected `autorun.inf` files on USB drives. Change passwords you typed on that machine
from a different, clean one. Do not run the updater until it has been checked.

We have not reported this to QRD. If you own the controller, QRD's support address is printed in its manual.
