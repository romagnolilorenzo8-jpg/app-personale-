"""Generazione di file calendario .ics (compatibili con Calendario di iPhone)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    out, b = [], line.encode("utf-8")
    while len(b) > 74:
        cut = 74
        while (b[cut] & 0xC0) == 0x80:  # non spezzare caratteri UTF-8
            cut -= 1
        out.append(b[:cut].decode())
        b = b[cut:]
    out.append(b.decode())
    return "\r\n ".join(out)


def _utc(local: str, tz: ZoneInfo) -> str:
    dt = datetime.fromisoformat(local).replace(tzinfo=tz).astimezone(timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def evento(ev: dict, tz: ZoneInfo) -> list[str]:
    """ev: uid, titolo, inizio, fine, tutto_il_giorno, luogo, note, avvisi(list di minuti)."""
    righe = ["BEGIN:VEVENT", f"UID:{ev['uid']}",
             f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
             f"SUMMARY:{_esc(ev['titolo'])}"]
    if ev.get("tutto_il_giorno"):
        d0 = date.fromisoformat(ev["inizio"][:10])
        d1 = date.fromisoformat((ev.get("fine") or ev["inizio"])[:10]) + timedelta(days=1)
        righe += [f"DTSTART;VALUE=DATE:{d0:%Y%m%d}", f"DTEND;VALUE=DATE:{d1:%Y%m%d}"]
    else:
        righe += [f"DTSTART:{_utc(ev['inizio'], tz)}", f"DTEND:{_utc(ev['fine'], tz)}"]
    if ev.get("rrule"):
        righe.append(f"RRULE:{ev['rrule']}")
    if ev.get("luogo"):
        righe.append(f"LOCATION:{_esc(ev['luogo'])}")
    if ev.get("note"):
        righe.append(f"DESCRIPTION:{_esc(ev['note'])}")
    for trig in ev.get("avvisi_assoluti", []):
        righe += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(ev['titolo'])}", f"TRIGGER:{trig}", "END:VALARM"]
    for minuti in ev.get("avvisi", []):
        righe += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_esc(ev['titolo'])}",
                  f"TRIGGER:-PT{int(minuti)}M", "END:VALARM"]
    righe.append("END:VEVENT")
    return righe


def calendario(eventi: list[dict], nome: str, tz: ZoneInfo) -> str:
    righe = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Scrigno//IT", "CALSCALE:GREGORIAN",
             "METHOD:PUBLISH", f"X-WR-CALNAME:{_esc(nome)}", f"X-WR-TIMEZONE:{tz.key}",
             "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"]
    for ev in eventi:
        righe += evento(ev, tz)
    righe.append("END:VCALENDAR")
    return "\r\n".join(_fold(r) for r in righe) + "\r\n"
