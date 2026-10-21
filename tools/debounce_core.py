"""Decision logic for the chatter filter (tools/debounce.py), kept free of evdev so it can be tested alone."""

# linux/input-event-codes.h
EV_SYN, EV_KEY, EV_ABS = 0, 1, 3
ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y = 0x02, 0x05, 0x10, 0x11
SWITCH_AXES = {ABS_Z, ABS_RZ, ABS_HAT0X, ABS_HAT0Y}   # the d-pad, and L2/R2 (3K and 4K on the Maestro S3)


def is_maestro(name, vendor, product):
    """The gamepad node of a DualShock 4 v2 (which the Maestro S3 reports itself as).

    The name is "Sony Interactive Entertainment Wireless Controller" over USB and "Wireless Controller" over
    Bluetooth. The motion-sensor and touchpad nodes carry a longer name and are not the pad."""
    return vendor == 0x054C and product == 0x09CC and name.endswith("Wireless Controller")


def is_switch(ev_type, code, value):
    """Events that behave like a switch: buttons (not key repeat) and the axes a switch can drive."""
    return (ev_type == EV_KEY and value in (0, 1)) or (ev_type == EV_ABS and code in SWITCH_AXES)


class Debouncer:
    """Leading-edge debounce with a trailing resync, tracked separately for every input.

    A change is forwarded straight away when the input has been quiet for `window` seconds. A change
    that comes sooner is held back, and when the window ends the input's real state is forwarded if
    it differs from what was last forwarded. So contact bounce is swallowed, a genuine fast tap still
    arrives (late by at most `window`), and an input can never be left stuck in the wrong state.

    Inputs are any hashable keys; every input is assumed to start at `rest`."""

    def __init__(self, window, rest=0):
        self.window = window
        self.rest = rest
        self._real = {}      # latest value seen
        self._sent = {}      # last value forwarded
        self._sent_at = {}   # when it was forwarded
        self._due = {}       # inputs with a held-back change, and when the hold ends

    def change(self, key, value, now):
        """The input moved to `value`. Returns the (key, value) changes to forward right now."""
        self._real[key] = value
        if value == self._sent.get(key, self.rest):
            self._due.pop(key, None)          # back where the outside world thinks it is
            return []
        sent_at = self._sent_at.get(key)
        if sent_at is None or now - sent_at >= self.window:
            self._forward(key, value, now)
            return [(key, value)]
        self._due[key] = sent_at + self.window
        return []

    def due(self, now):
        """Hold-backs that have ended by `now`. Returns the (key, value) changes to forward."""
        out = []
        for key, deadline in sorted(self._due.items(), key=lambda item: item[1]):
            if deadline > now:
                continue
            # a hold only exists while the real state differs from the forwarded one
            self._forward(key, self._real[key], now)
            out.append((key, self._real[key]))
        return out

    def next_deadline(self):
        return min(self._due.values()) if self._due else None

    def _forward(self, key, value, now):
        self._sent[key] = value
        self._sent_at[key] = now
        self._due.pop(key, None)


class Filter:
    """Sits between the real pad and the virtual one: debounces switch-like events, passes the rest through,
    and says what to write. Actions are ("event", type, code, value) or ("syn",)."""

    def __init__(self, window):
        self._debouncer = Debouncer(window)
        self._dirty = False      # events written since the last SYN
        self.seen = 0            # switch changes read
        self.forwarded = 0       # switch changes written

    def feed(self, ev_type, code, value, now):
        if ev_type == EV_SYN:
            if not self._dirty:
                return []
            self._dirty = False
            return [("syn",)]
        if is_switch(ev_type, code, value):
            self.seen += 1
            changes = self._debouncer.change((ev_type, code), value, now)
            self.forwarded += len(changes)
            out = [("event", t, c, v) for (t, c), v in changes]
        else:
            out = [("event", ev_type, code, value)]
        if out:
            self._dirty = True
        return out

    def due(self, now):
        """Changes whose hold-back has ended, in a packet of their own."""
        changes = self._debouncer.due(now)
        if not changes:
            return []
        self.forwarded += len(changes)
        self._dirty = False
        return [("event", t, c, v) for (t, c), v in changes] + [("syn",)]

    def next_deadline(self):
        return self._debouncer.next_deadline()
