#!/usr/bin/env bash
# Build an SDL2 GameControllerDB line for the controller from its live evdev identity.
# Usage: tools/sdl-mapping.sh > ~/maestro-s3-sdl.txt     (a failed run still empties the file you redirect to)
#        export SDL_GAMECONTROLLERCONFIG="$(cat ~/maestro-s3-sdl.txt)"
#
# SDL's built-in HIDAPI PS4 driver normally handles this controller already; this mapping matters
# when HIDAPI is off (SDL_JOYSTICK_HIDAPI=0) or a game reads raw evdev.
# SYSFS overrides /sys (used by the tests).
set -euo pipefail
sysfs=${SYSFS:-/sys}

# The pad node: DualShock 4 v2 ids and a name ending in "Wireless Controller". The USB name has a Sony prefix and the
# Bluetooth name does not; the motion-sensor and touchpad nodes have longer names.
is_pad() {
  local d=$1/device name vendor product
  name=$(cat "$d/name" 2>/dev/null) vendor=$(cat "$d/id/vendor" 2>/dev/null) product=$(cat "$d/id/product" 2>/dev/null)
  [[ ${vendor,,} == 054c && ${product,,} == 09cc && $name == *"Wireless Controller" ]]
}

ev=""
for d in "$sysfs"/class/input/event*; do
  if is_pad "$d"; then
    ev=$d
    break
  fi
done
[[ -n $ev ]] || { echo "sdl-mapping: Maestro S3 not connected" >&2; exit 1; }

le16() { printf '%02x%02x' $((0x$1 & 0xff)) $(((0x$1 >> 8) & 0xff)); }
id=$ev/device/id
guid="$(le16 "$(cat "$id/bustype")")0000$(le16 "$(cat "$id/vendor")")0000$(le16 "$(cat "$id/product")")0000$(le16 "$(cat "$id/version")")0000"

# hid-playstation evdev button order: cross, circle, triangle, square, L1, R1, L2, R2, share, options, PS, L3, R3
echo "${guid},QRD Maestro S3,a:b0,b:b1,y:b2,x:b3,leftshoulder:b4,rightshoulder:b5,lefttrigger:b6,righttrigger:b7,back:b8,start:b9,guide:b10,leftstick:b11,rightstick:b12,dpup:h0.1,dpright:h0.2,dpdown:h0.4,dpleft:h0.8,leftx:a0,lefty:a1,rightx:a3,righty:a4,platform:Linux,"
