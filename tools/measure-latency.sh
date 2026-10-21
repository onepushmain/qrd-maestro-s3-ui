#!/usr/bin/env bash
# Ground-truth USB polling measurement for the Maestro S3 via usbmon (wired mode only).
# Read-only: usbmon passively observes the bus. Needs root for debugfs.
# Usage: sudo tools/measure-latency.sh [seconds]   (hold or mash buttons while it runs)
set -euo pipefail
secs=${1:-5}

devpath=""
for d in /sys/bus/usb/devices/*; do
  [[ "$(cat "$d/idVendor" 2>/dev/null)" == "054c" && "$(cat "$d/idProduct" 2>/dev/null)" == "09cc" ]] && { devpath=$d; break; }
done
[[ -n "$devpath" ]] || { echo "Maestro S3 not found on USB (Bluetooth can't be measured with usbmon)"; exit 1; }
bus=$(cat "$devpath/busnum"); dev=$(cat "$devpath/devnum")
printf -v devp '%03d' "$dev"

modprobe usbmon
mountpoint -q /sys/kernel/debug || mount -t debugfs none /sys/kernel/debug
echo "Capturing bus $bus device $dev for ${secs}s — mash buttons now..."

# usbmon text: tag timestamp(us) C/S Ii:bus:dev:ep ...  -> keep interrupt-IN completions
timeout "$secs" cat "/sys/kernel/debug/usb/usbmon/${bus}u" 2>/dev/null \
  | awk -v want="Ii:${bus}:${devp}:" '$3=="C" && index($4,want)==1 {print $2}' \
  | awk 'NR>1 {d=$1-p; if (d>0 && d<100000) {n++; s+=d; ss+=d*d; if(!mn||d<mn)mn=d; if(d>mx)mx=d}} {p=$1}
         END { if (!n) {print "No reports captured (is it in wired mode? press buttons during capture)"; exit}
               m=s/n; sd=sqrt(ss/n-m*m);
               printf "reports: %d\nmean interval: %.3f ms  (%.0f Hz)\nmin/max: %.3f / %.3f ms\njitter (sd): %.3f ms\n", n+1, m/1000, 1e6/m, mn/1000, mx/1000, sd/1000 }'
