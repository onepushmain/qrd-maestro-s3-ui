#!/usr/bin/env bash
# Build an SDL2 GameControllerDB line for the Maestro S3 from its live evdev identity.
# Usage: tools/sdl-mapping.sh  > dist/maestro-s3-sdl.txt
#        export SDL_GAMECONTROLLERCONFIG="$(cat dist/maestro-s3-sdl.txt)"
#
# Note: SDL's built-in HIDAPI PS4 driver normally handles this controller already.
# This mapping matters when HIDAPI is off (SDL_JOYSTICK_HIDAPI=0) or a game uses raw evdev.
set -euo pipefail

ev=""
for d in /sys/class/input/event*; do
  [[ "$(cat "$d/device/name" 2>/dev/null)" == "Sony Interactive Entertainment Wireless Controller" ]] && { ev=$d; break; }
done
[[ -n "$ev" ]] || { echo "Maestro S3 not connected" >&2; exit 1; }

le16() { printf '%02x%02x' $((0x$1 & 0xff)) $(((0x$1 >> 8) & 0xff)); }
id=$ev/device/id
guid="$(le16 "$(cat $id/bustype)")0000$(le16 "$(cat $id/vendor)")0000$(le16 "$(cat $id/product)")0000$(le16 "$(cat $id/version)")0000"

# hid-playstation evdev order: cross,circle,triangle,square,L1,R1,L2,R2,share,options,PS,L3,R3
echo "${guid},QRD Maestro S3,a:b0,b:b1,y:b2,x:b3,leftshoulder:b4,rightshoulder:b5,lefttrigger:b6,righttrigger:b7,back:b8,start:b9,guide:b10,leftstick:b11,rightstick:b12,dpup:h0.1,dpright:h0.2,dpdown:h0.4,dpleft:h0.8,leftx:a0,lefty:a1,rightx:a3,righty:a4,platform:Linux,"
