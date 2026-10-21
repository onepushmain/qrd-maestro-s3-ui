"""Decision logic for the chatter filter (tools/debounce.py), kept free of evdev so it can be tested alone."""


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
