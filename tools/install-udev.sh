#!/usr/bin/env bash
# Install udev rules for one QRD Maestro S3: stable device names, and access for the browser dashboard and lightbar tool.
#
# Usage: tools/install-udev.sh [--mac AA:BB:CC:DD:EE:FF] [--uinput] [--print | --remove]
#   --mac      the controller's Bluetooth MAC (default: the one controller that is connected; re/identify.py shows it)
#   --uinput   also let your user create virtual input devices (needed by tools/debounce.py)
#   --print    show the rules and stop; installs nothing and never calls sudo
#   --remove   delete the installed rules
# Installing and removing need sudo. SYSFS overrides /sys (used by the tests).
set -euo pipefail
sysfs=${SYSFS:-/sys}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
rules_dir=/etc/udev/rules.d
main_name=70-qrd-maestro-s3.rules
uinput_name=71-qrd-maestro-s3-uinput.rules

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }
die() { echo "install-udev: $1" >&2; exit "${2:-1}"; }

mac="" uinput=0 action=install
while [[ $# -gt 0 ]]; do
  case $1 in
    --mac) [[ -n ${2:-} ]] || die "--mac needs a value" 2; mac=$2; shift 2 ;;
    --uinput) uinput=1; shift ;;
    --print) action=print; shift ;;
    --remove) action=remove; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" 2 ;;
  esac
done

sudo_cmd=()
[[ $EUID -eq 0 ]] || sudo_cmd=(sudo)
reload() {
  "${sudo_cmd[@]}" udevadm control --reload
  "${sudo_cmd[@]}" udevadm trigger --subsystem-match=input --subsystem-match=hidraw --subsystem-match=leds --action=change
}

if [[ $action == remove ]]; then
  "${sudo_cmd[@]}" rm -f "$rules_dir/$main_name" "$rules_dir/$uinput_name"
  reload
  echo "Removed the Maestro S3 udev rules."
  exit 0
fi

connected_macs() {
  local d uniq
  for d in "$sysfs"/class/input/event*/device; do
    [[ -r $d/name && -r $d/uniq && -r $d/id/vendor && -r $d/id/product ]] || continue
    if [[ "$(<"$d/name")" == "Sony Interactive Entertainment Wireless Controller" \
          && "$(<"$d/id/vendor")" == 054c && "$(<"$d/id/product")" == 09cc ]]; then
      uniq=$(<"$d/uniq")
      if [[ -n $uniq ]]; then echo "${uniq,,}"; fi
    fi
  done
}

if [[ -z $mac ]]; then
  mapfile -t found < <(connected_macs | sort -u)
  case ${#found[@]} in
    0) die "No Maestro S3 found. Connect it, or pass --mac (python3 re/identify.py prints it)." ;;
    1) mac=${found[0]} ;;
    *) die "More than one DualShock-type controller is connected (${found[*]}). Pass --mac to choose." 2 ;;
  esac
fi
[[ $mac =~ ^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$ ]] || die "not a MAC address: $mac (expected AA:BB:CC:DD:EE:FF)" 2
mac=${mac,,}

render() { sed "s/@MAC@/$mac/g" "$here/dist/70-qrd-maestro-s3.rules.in"; }

if [[ $action == print ]]; then
  echo "# ---- $rules_dir/$main_name ----"
  render
  if (( uinput )); then
    echo
    echo "# ---- $rules_dir/$uinput_name ----"
    cat "$here/dist/71-qrd-maestro-s3-uinput.rules"
  fi
  exit 0
fi

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
render > "$tmp"
"${sudo_cmd[@]}" install -m 0644 "$tmp" "$rules_dir/$main_name"
if (( uinput )); then
  "${sudo_cmd[@]}" install -m 0644 "$here/dist/71-qrd-maestro-s3-uinput.rules" "$rules_dir/$uinput_name"
fi
reload
echo "Installed rules for $mac in $rules_dir and reloaded udev. If a name or permission has not appeared, unplug and reconnect the controller."
