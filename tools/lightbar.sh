#!/usr/bin/env bash
# Set the controller's lightbar through the kernel's LED interface (hid-playstation).
# Runtime only: nothing is written to the controller's saved settings.
# Usage: tools/lightbar.sh R G B     each 0-255, for example: tools/lightbar.sh 0 0 255
#        tools/lightbar.sh off
#        tools/lightbar.sh battery   green above 60%, amber above 25%, red below
# The LED files are root-only by default: run with sudo, or install the udev rules
# (tools/install-udev.sh) so your own user can write them. SYSFS overrides /sys (used by the tests).
set -euo pipefail
sysfs=${SYSFS:-/sys}

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "lightbar: $1" >&2; exit "${2:-1}"; }
channel_ok() { [[ $1 =~ ^[0-9]+$ ]] && (( 10#$1 <= 255 )); }

case "${1:-}" in
  ''|-h|--help) usage; exit 0 ;;
  off|battery) mode=$1 ;;
  *)
    if [[ $# -eq 3 ]] && channel_ok "$1" && channel_ok "$2" && channel_ok "$3"; then
      mode=rgb
    else
      die "R, G and B must be whole numbers in the range 0-255 (got: $*)" 2
    fi ;;
esac

led=""
for l in "$sysfs"/class/leds/input*:red; do
  [[ -e $l ]] || continue
  if grep -qE '^HID_ID=000[35]:0000054C:000009CC$' "$l/device/uevent" 2>/dev/null; then
    led=${l%:red}
    break
  fi
done
[[ -n $led ]] || die "Maestro S3 lightbar not found (is the controller connected?)"

set_rgb() {
  { echo "$1" > "$led:red/brightness" && echo "$2" > "$led:green/brightness" && echo "$3" > "$led:blue/brightness"; } 2>/dev/null \
    || die "cannot write the LED files; run with sudo, or install the udev rules (tools/install-udev.sh)"
}

case $mode in
  off) set_rgb 0 0 0 ;;
  rgb) set_rgb "$((10#$1))" "$((10#$2))" "$((10#$3))" ;;
  battery)
    cap=""
    for f in "$sysfs"/class/power_supply/ps-controller-battery-*/capacity; do
      if [[ -r $f ]]; then cap=$(<"$f"); break; fi
    done
    [[ $cap =~ ^[0-9]+$ ]] || die "no battery information for the controller"
    if   (( cap > 60 )); then set_rgb 0 255 0
    elif (( cap > 25 )); then set_rgb 255 140 0
    else set_rgb 255 0 0; fi
    echo "battery ${cap}%" ;;
esac
