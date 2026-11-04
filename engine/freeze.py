"""B22 Freeze/Resume and the resume gate, code side (build plan, module 11).

freeze()   picks the newest checkpoint on a branch as the snapshot and
           returns a resume token and a QR payload. Only the token's SHA-256
           is stored, so the database alone can't be used to resume.
gate()     compares what the camera sees now with the snapshot, in code:
             moved    a tube's printed number is read in a different slot
             missing  a snapshot tube is not seen in any slot
             extra    a tube is seen that the snapshot did not have
             colour   colour difference (CIE76 delta E) over DE_TOLERANCE
           A tube whose label can't be read is identified by its slot and
           noted as unconfirmed; that alone does not block. Any other
           difference blocks until it is acknowledged.
ack()      records who acknowledged which differences, by voice or tap, and
           when. Rows are only ever inserted.
briefing() Wonder writes the morning briefing from the snapshot and the gate
           result; its reply is validated and falls back to plain lines.

What the camera sees (slots, printed numbers, colours) will come from SAM
and the colour reader (B04) on a 3 s clip; here it is an input.
DE_TOLERANCE is a starting value to tune on dev runs 1-10, not a measurement.
"""

from __future__ import annotations

import hashlib
import json
import math
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Callable

from .schema import Checkpoint
from .store import Store

DE_TOLERANCE = 10.0
QR_PREFIX = "labspotter://resume?token="
ACK_METHODS = ("voice", "tap")

TABLES = """
CREATE TABLE IF NOT EXISTS freezes (token_hash TEXT PRIMARY KEY, run_id TEXT NOT NULL, branch TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL, checkpoint_hash TEXT NOT NULL, name TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS gate_acks (run_id TEXT NOT NULL, checkpoint_id TEXT NOT NULL, differences TEXT NOT NULL,
  speaker TEXT, method TEXT NOT NULL, t REAL NOT NULL);
"""


class FreezeError(ValueError):
    pass


@dataclass(frozen=True)
class Seen:
    """One tube as the resume clip shows it."""
    slot: int
    label: int | None            # printed number, None if unreadable
    colour_lab: list[float] | None


@dataclass
class GateResult:
    run_id: str
    checkpoint_id: str
    status: str                  # "pass" or "blocked"
    differences: list[dict] = field(default_factory=list)
    unconfirmed: list[int] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _tables(store: Store) -> None:
    store.db.executescript(TABLES)


def freeze(store: Store, run_id: str, name: str, branch: str = "main",
           clock: Callable[[], float] = time.time) -> dict:
    run = store.load_run(run_id)                      # verifies the chain first
    chain = run.branch(branch)
    if not chain:
        raise FreezeError(f"branch {branch} has no checkpoint to freeze")
    cp = chain[-1]
    token = secrets.token_urlsafe(24)
    _tables(store)
    store.db.execute("INSERT INTO freezes VALUES (?,?,?,?,?,?,?)",
                     (_hash(token), run_id, branch, cp.id, cp.hash, name, float(clock())))
    return {"token": token, "qr": QR_PREFIX + token, "run_id": run_id, "checkpoint_id": cp.id, "name": name}


def resume(store: Store, token_or_qr: str) -> Checkpoint:
    """The frozen checkpoint for a token, after re-verifying the run."""
    token = token_or_qr[len(QR_PREFIX):] if token_or_qr.startswith(QR_PREFIX) else token_or_qr
    _tables(store)
    row = store.db.execute("SELECT run_id, checkpoint_id, checkpoint_hash FROM freezes WHERE token_hash=?",
                           (_hash(token),)).fetchone()
    if not row:
        raise FreezeError("unknown resume token")
    run = store.load_run(row[0])
    cp = next((c for c in run.checkpoints if c.id == row[1]), None)
    if cp is None or cp.hash != row[2]:
        raise FreezeError("the frozen checkpoint is missing or changed since the freeze")
    return cp


def delta_e(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def gate(snapshot: Checkpoint, seen: list[Seen], tolerance: float = DE_TOLERANCE) -> GateResult:
    diffs, unconfirmed = [], []
    want = {t.tube: t for t in snapshot.tubes if t.contents}      # tubes that hold something
    by_slot = {t.slot: t for t in snapshot.tubes}
    slots_seen = [s.slot for s in seen]
    if len(set(slots_seen)) != len(slots_seen):
        raise FreezeError("two tubes reported in one slot")
    labels = [s.label for s in seen if s.label is not None]
    if len(set(labels)) != len(labels):
        raise FreezeError("one tube number read in two slots")
    found: set[int] = set()
    for s in seen:
        if s.label is None:
            tube = by_slot.get(s.slot)
            if tube is None:
                diffs.append({"kind": "extra", "tube": None, "slot": s.slot})
                continue
            unconfirmed.append(tube.tube)
        else:
            tube = next((t for t in snapshot.tubes if t.tube == s.label), None)
            if tube is None:
                diffs.append({"kind": "extra", "tube": s.label, "slot": s.slot})
                continue
            if tube.slot != s.slot:
                diffs.append({"kind": "moved", "tube": tube.tube, "from_slot": tube.slot, "to_slot": s.slot})
        found.add(tube.tube)
        if tube.colour_lab is not None and s.colour_lab is not None:
            de = delta_e(tube.colour_lab, s.colour_lab)
            if de > tolerance:
                diffs.append({"kind": "colour", "tube": tube.tube, "delta_e": round(de, 2)})
    for n in sorted(set(want) - found):
        diffs.append({"kind": "missing", "tube": n, "slot": want[n].slot})
    return GateResult(snapshot.run_id, snapshot.id, "blocked" if diffs else "pass", diffs, sorted(unconfirmed))


def ack(store: Store, result: GateResult, speaker: str | None, method: str,
        clock: Callable[[], float] = time.time) -> GateResult:
    """Record the acknowledgement and clear the block. Nothing to ack is an error."""
    if method not in ACK_METHODS:
        raise FreezeError(f"method must be one of {ACK_METHODS}")
    if result.status != "blocked":
        raise FreezeError("nothing to acknowledge")
    _tables(store)
    store.db.execute("INSERT INTO gate_acks VALUES (?,?,?,?,?,?)",
                     (result.run_id, result.checkpoint_id, json.dumps(result.differences, sort_keys=True),
                      speaker, method, float(clock())))
    return GateResult(result.run_id, result.checkpoint_id, "acknowledged", result.differences, result.unconfirmed)


def acks(store: Store, run_id: str) -> list[dict]:
    _tables(store)
    rows = store.db.execute("SELECT checkpoint_id, differences, speaker, method, t FROM gate_acks WHERE run_id=? "
                            "ORDER BY rowid", (run_id,)).fetchall()
    return [{"checkpoint_id": r[0], "differences": json.loads(r[1]), "speaker": r[2], "method": r[3], "t": r[4]}
            for r in rows]


def plain_briefing(snapshot: Checkpoint, result: GateResult) -> list[str]:
    lines = [f"Resuming {snapshot.run_id} after step {snapshot.step}."]
    if not result.differences:
        lines.append("The bench matches the freeze.")
    for d in result.differences:
        if d["kind"] == "moved":
            lines.append(f"Tube {d['tube']} moved from slot {d['from_slot']} to slot {d['to_slot']}.")
        elif d["kind"] == "colour":
            lines.append(f"Tube {d['tube']} changed colour (delta E {d['delta_e']:g}).")
        elif d["kind"] == "missing":
            lines.append(f"Tube {d['tube']} is not in the rack.")
        else:
            lines.append(f"An unexpected tube is in slot {d['slot']}.")
    if result.unconfirmed:
        lines.append(f"Labels not read for tubes {', '.join(map(str, result.unconfirmed))}; check them.")
    return lines


def briefing(snapshot: Checkpoint, result: GateResult, ask: Callable[[str], str] | None) -> dict:
    """Wonder's words for the morning, or the plain lines if it fails."""
    facts = {"run_id": snapshot.run_id, "step": snapshot.step, "checkpoint_id": snapshot.id,
             "gate": result.to_dict()}
    if ask is None:
        return {"prose": None, "lines": plain_briefing(snapshot, result), "error": "no writer"}
    prompt = ("Write a short resume briefing for a student returning to a frozen lab run. The facts were computed by "
              "code; do not add or drop differences. Answer only with JSON "
              '{"summary": string, "steps": [string], "estimated_minutes": number or null, "evidence_refs": [string]}.'
              f"\nFACTS\n{json.dumps(facts)}")
    known = {snapshot.id} | {e.path for e in snapshot.evidence}
    try:
        data = json.loads(ask(prompt))
        if not isinstance(data, dict) or set(data) != {"summary", "steps", "estimated_minutes", "evidence_refs"}:
            raise ValueError("off-schema briefing")
        if not isinstance(data["summary"], str) or not isinstance(data["steps"], list) \
                or not all(isinstance(s, str) for s in data["steps"]):
            raise ValueError("summary and steps must be text")
        m = data["estimated_minutes"]
        if m is not None and (not isinstance(m, (int, float)) or isinstance(m, bool) or m < 0):
            raise ValueError("estimated_minutes must be a number or null")
        refs = data["evidence_refs"]
        if not isinstance(refs, list) or any(not isinstance(r, str) or r not in known for r in refs):
            raise ValueError("evidence not in the run")
        return {"prose": data, "lines": plain_briefing(snapshot, result), "error": None}
    except Exception as e:  # noqa: BLE001 - any Wonder failure falls back to plain lines
        return {"prose": None, "lines": plain_briefing(snapshot, result), "error": f"{type(e).__name__}: {e}"}
