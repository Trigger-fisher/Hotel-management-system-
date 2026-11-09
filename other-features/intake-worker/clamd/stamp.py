"""Sets the time of the stamp file to the OLDEST last good check among the enabled Sanesecurity feeds (fangfrisch's
refresh log). A feed that was never checked leaves the stamp as it is. The worker reads the stamp for the 48-hour alert.

    /opt/fangfrisch/bin/python stamp.py /etc/fangfrisch.conf /var/lib/clamav/sanesecurity.checked"""
from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone


def enabled_urls(conf: str) -> list[str]:
    from fangfrisch.config.config import config
    from fangfrisch.refresh import _clamav_items

    if not config.init(conf):
        raise SystemExit(f"cannot read {conf}")
    return [item.url for item in _clamav_items() if item.section == "sanesecurity"]


def oldest_check(db: str, urls: list[str]) -> datetime | None:
    with sqlite3.connect(db) as con:
        rows = dict(con.execute("SELECT url, updated FROM refreshlog WHERE provider = 'sanesecurity'"))
    if not urls or any(not rows.get(u) for u in urls):
        return None
    return min(datetime.fromisoformat(str(rows[u])).replace(tzinfo=timezone.utc) for u in urls)


def write_stamp(path: str, when: datetime) -> None:
    if not os.path.exists(path):
        open(path, "wb").close()
    os.utime(path, (when.timestamp(), when.timestamp()))


def main(conf: str, stamp: str, db: str = "/var/lib/fangfrisch/db.sqlite") -> int:
    when = oldest_check(db, enabled_urls(conf))
    if when is None:
        print("feeds: not every feed has had a good check yet")
        return 1
    write_stamp(stamp, when)
    print(f"feeds: oldest good check {when.isoformat(timespec='seconds')}")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:]))
