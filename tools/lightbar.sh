#!/usr/bin/env bash
# Set the Maestro S3 lightbar through the kernel's hid-playstation LED interface.
# Runtime-only and reversible — nothing is written to controller flash.
# Usage: tools/lightbar.sh R G B        e.g. tools/lightbar.sh 0 0 255
#        tools/lightbar.sh off
#        tools/lightbar.sh battery      (green > 60%, amber > 25%, red otherwise)
# Without the build-2 udev rule, run with sudo.
set -euo pipefail

led=""
for l in /sys/class/leds/input*:red; do
  grep -qE "^HID_ID=000[35]:0000054C:000009CC$" "$l/device/uevent" 2>/dev/null && { led=${l%:red}; break; }
done
[[ -n "$led" ]] || { echo "Maestro S3 lightbar not found"; exit 1; }

set_rgb() { echo "$1" > "$led:red/brightness"; echo "$2" > "$led:green/brightness"; echo "$3" > "$led:blue/brightness"; }

case "${1:-}" in
  off) set_rgb 0 0 0 ;;
  battery)
    cap=$(cat /sys/class/power_supply/ps-controller-battery-*/capacity | head -1)
    if   (( cap > 60 )); then set_rgb 0 255 0
    elif (( cap > 25 )); then set_rgb 255 140 0
    else set_rgb 255 0 0; fi
    echo "battery ${cap}%" ;;
  ''|-h|--help) sed -n '2,8p' "$0" ;;
  *) set_rgb "$1" "$2" "$3" ;;
esac
