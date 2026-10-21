# Maestro S3 custom-firmware plan (reverse engineering)

Goal: control the button LEDs (and later other settings) from our dashboard.
Hard rules: don't brick it, keep it working on Windows and PlayStation. Every phase ends at a
**gate**. We don't move past a gate until its condition is met.

## What recon found (2026-10-20, static analysis only, nothing executed)

**1. QRD's official updater download is infected with malware.**
`Firmware-Update-Tool-for-Maestro-S3-V1-05-1.zip` from QRD's firmware page
(`pub-e480636cfcf74919b39a81a216c26054.r2.dev`) contains a Delphi wrapper matching the
**XRed / "Synaptics Pointing Device Driver" worm**:
- C2/update URLs `xred.site50.net/syn/SUpdate.ini`, `Synaptics.rar`, `SSLLibrary.dll`, Dropbox mirrors
- `Synaptics.exe` dropper strings, `._cache_` original-file prefix, `EXERESX`/`EXEVSNX` resources
- `KBHKS` keyboard-hook resource (keylogger), `smtp.gmail.com` exfiltration, `xl/vbaProject.bin` Excel-macro infection
- exe sha256 `8e8f5b68e30c49932687c7e0d76204027f7d033d50585a9ca5998ab83ce01ae9`
  (zip sha256 `3772450897c505b645a5823a1bab509d7a6b0c2d7d35a0327d1d0e32ce4665ee`)
Quarantined (read-only, renamed) in the session scratchpad. **Never run it.**

**2. The real updater inside points to an Actions Semiconductor chip.**
The wrapped original ships `Driver/AdfuWinUsb.inf`: **ADFU** is Actions Semiconductor's USB
firmware-upgrade mode. That strongly suggests the controller is built on an **Actions Bluetooth
SoC** (ATS28xx/30xx family, common in wireless controllers). Holding **2P while plugging in** is
how it enters ADFU. Still unconfirmed until we read the chip markings.

## Phase 0: Safety (now)
- Don't run QRD's updater on any PC. If it has ever been run on a Windows machine, check for
  `C:\ProgramData\Synaptics\Synaptics.exe` and a "Synaptics Pointing Device Driver" autorun entry, then run a full AV scan.
- Report to QRD (support@ / store contact) with the hashes above.
- Optional, with your OK: look the hash up on VirusTotal (this sends the hash to an outside service).

**Gate 0:** no machine is running the infected tool.

## Phase 1: Identify the hardware (zero risk)
- Open the case and photograph the main board, both sides.
- Read the chip markings: the SoC (expect `ATS…`), the flash chip (often a separate SPI NOR such as `25Q…`), any auth chip.
- Look for test pads: SWD/JTAG, UART TX/RX, and the flash chip's pins (SOIC-8 clip access).

**Gate 1:** we know the exact SoC and flash part.

## Phase 2: Get the clean updater and firmware image (zero risk, Linux, static)
- Extract the original program from the worm's `EXERESX` resource with a PE resource parser. Don't execute it.
- Find the firmware image inside (Actions images are usually `.fw` containers with a partition table).
- Answer: is it **signed**? **encrypted**? what's the load address and CPU architecture?

**Gate 2:** we have a parseable, unsigned image. If it's signed or encrypted, patching (Option B) is off. Skip to Option C.

## Phase 3: Look at the bootloader without writing (read-only)
- Hold 2P, plug in, and record the USB ID that appears (Actions ADFU is usually VID `10d6`). Send nothing.
- Check whether ADFU lives in **mask ROM**. Datasheet or community docs for the identified SoC tell us. ROM ADFU means a bad flash is recoverable by re-entering ADFU and flashing the official image.

**Gate 3:** recovery path confirmed (ROM bootloader + a clean official image we can flash with a clean tool).

## Phase 4: Full backup (the safety net)
- Dump the complete flash, either through ADFU read commands (if the Actions tooling supports read-back) or with a SOIC-8 clip and a CH341A programmer on the SPI flash.
- Verify the dump twice (two reads, same hash) and store it off the machine.

**Gate 4:** two matching full dumps exist. **No write happens before this gate.**

## Phase 5: Minimal patch (Option B)
- Disassemble the image (Ghidra plus the SoC's CPU module).
- Find the DS4 output-report handler (report `0x05`) and the button-LED driver.
- Patch the smallest possible change: route the lightbar RGB bytes, which the firmware already receives, to the button LED driver.
- Leave USB identity, PlayStation auth, Bluetooth, SOCD and latency untouched, so Windows and PS keep working.
- Flash, test, and restore the backup on any failure.

**Gate 5:** LEDs follow our dashboard; PC, Windows and PlayStation still work.

## Phase 6: Dashboard integration
- The dashboard already sends report `0x05` (Settings, Controller lightbar). Extend it to per-button colours and effects once we know what the patched firmware supports.

## Fallback: Option C (no flashing at all)
If any gate fails: move the buttons to an open-source **GP2040-CE** (RP2040) board and keep the original board.
Full LED, SOCD and remap control with a browser config page. Fully reversible by swapping boards back.
It's wired only, and PlayStation needs an extra auth key.
