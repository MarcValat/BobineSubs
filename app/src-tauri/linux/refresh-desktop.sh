#!/bin/sh
# Run by dpkg after install, upgrade and removal: the menus, the icon
# themes and the software centers pick up the new icon and entries at once,
# instead of a stale cached icon until the next login (or a cleared cache).
# Every tool is optional; none may fail the install.
touch /usr/share/icons/hicolor 2>/dev/null || true
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi
if command -v appstreamcli >/dev/null 2>&1; then
  appstreamcli refresh-cache --force >/dev/null 2>&1 || true
fi
exit 0
