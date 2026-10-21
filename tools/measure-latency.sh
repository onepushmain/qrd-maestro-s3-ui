#!/usr/bin/env bash
# Measure how often the controller delivers reports over USB, using usbmon.
# Passive: usbmon only watches the bus. Capturing needs root. USB only (usbmon cannot see Bluetooth).
#
# Usage: sudo tools/measure-latency.sh [SECONDS]            capture for SECONDS (default 5); mash buttons meanwhile
#        tools/measure-latency.sh --analyze FILE [BUS DEV]  analyse a saved usbmon text capture (no root needed)
set -euo pipefail
sysfs=${SYSFS:-/sys}

usage() { sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "measure-latency: $1" >&2; exit "${2:-1}"; }

# stdin: usbmon text lines. $1: address prefix to keep, for example Ii:5:002:
# usbmon lines read: tag, timestamp in microseconds, event (S submit, C complete), address, ...
# If the device has more than one interrupt endpoint, the one with the most reports is the input stream.
summarise() {
  awk -v want="$1" '
    $3=="C" && index($4,want)==1 { n[$4]++; t[$4, n[$4]] = $2 }
    END {
      best = ""
      for (a in n) if (best == "" || n[a] > n[best] || (n[a] == n[best] && a < best)) best = a
      if (best == "") exit 3
      for (i = 2; i <= n[best]; i++) {
        d = t[best, i] - t[best, i-1]
        if (d > 0 && d < 100000) { c++; s += d; ss += d*d; if (!mn || d < mn) mn = d; if (d > mx) mx = d }
      }
      if (!c) exit 3
      m = s/c; v = ss/c - m*m; if (v < 0) v = 0
      printf "reports: %d\nmean interval: %.3f ms  (%.0f Hz)\nmin/max: %.3f / %.3f ms\njitter (sd): %.3f ms\n", n[best], m/1000, 1e6/m, mn/1000, mx/1000, sqrt(v)/1000
    }'
}

# prints "BUS DEV" of the first USB device with the controller's id
find_usb() {
  local d
  for d in "$sysfs"/bus/usb/devices/*; do
    if [[ "$(cat "$d/idVendor" 2>/dev/null)" == 054c && "$(cat "$d/idProduct" 2>/dev/null)" == 09cc ]]; then
      echo "$(<"$d/busnum") $(<"$d/devnum")"
      return 0
    fi
  done
  return 1
}

analyse() {   # reads usbmon text on stdin
  local out
  if ! out=$(summarise "Ii:$1:$(printf '%03d' "$2"):"); then
    die "No reports captured. Is the controller on USB (not Bluetooth), and were you pressing buttons?"
  fi
  echo "$out"
}

case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --analyze)
    file=${2:-}
    [[ -n $file && -r $file ]] || die "--analyze needs a readable usbmon capture file" 2
    if [[ -n ${3:-} && -n ${4:-} ]]; then bus=$3 dev=$4
    else read -r bus dev < <(find_usb) || die "Maestro S3 not found on USB; pass BUS and DEV after the file name" 2
    fi
    analyse "$bus" "$dev" < "$file" ;;
  *)
    secs=${1:-5}
    [[ $secs =~ ^[0-9]+([.][0-9]+)?$ ]] && awk "BEGIN{exit !($secs > 0)}" || die "the number of seconds must be positive (got: $secs)" 2
    [[ $EUID -eq 0 ]] || die "capturing needs root for usbmon; run it with sudo"
    read -r bus dev < <(find_usb) || die "Maestro S3 not found on USB (Bluetooth cannot be measured with usbmon)"
    modprobe usbmon
    mountpoint -q /sys/kernel/debug || mount -t debugfs none /sys/kernel/debug
    echo "Capturing bus $bus device $dev for ${secs}s: mash buttons now..."
    { timeout "$secs" cat "/sys/kernel/debug/usb/usbmon/${bus}u" 2>/dev/null || true; } | analyse "$bus" "$dev" ;;
esac
