.PHONY: test lint

# Browser tests skip themselves when Chromium is missing. The shell and Python tools run against fake
# sysfs trees, so nothing here touches real hardware.
test:
	node --test tests/*.test.js
	python3 -m unittest discover -s tests -p 'test_*.py'

lint:
	@for f in tools/*.sh; do bash -n "$$f" || exit 1; done
	python3 -m py_compile re/*.py tools/*.py
	node --check core.js && node --check app.js && node --check demo.js
	@if command -v shellcheck >/dev/null; then shellcheck tools/*.sh; else echo "shellcheck not installed; skipped"; fi
