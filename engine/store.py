"""B10 SQLite store: an append-only, hash-chained log per run.

Every record (event, checkpoint, alert) is a row in `log` with
hash = sha256(canonical_json({run_id, seq, kind, payload, prev_hash})), so a
run's whole history is one chain. Checkpoints also keep their own per-branch
chain (engine/schema.py seal/verify_chain). load_run() verifies both and
raises ChainError on any edit, deletion or reordering.

Rows are never updated; an alert status change is a new alert row with the
same id, and the latest row wins.

Head file: dropping the newest rows leaves a valid prefix, so each run's
head (seq, hash) is also written outside SQLite, to an append-only JSONL
sidecar next to the database (<db>.heads.jsonl). The head line is written
and fsynced before the row commits; if the commit then fails the head is
ahead of the database and load_run refuses (fail closed). load_run checks
the newest head line for the run by default. An in-memory database keeps
its heads in memory unless heads_path is given.
"""

import hashlib
import json
import os
import sqlite3
from pathlib import Path

from .schema import Alert, ChainError, Checkpoint, Event, canonical_json, seal, verify_chain

KINDS = ("event", "checkpoint", "alert")

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, protocol TEXT NOT NULL, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS log (
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('event','checkpoint','alert')),
  payload TEXT NOT NULL,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
"""


def record_hash(run_id: str, seq: int, kind: str, payload: str, prev_hash: str | None) -> str:
    body = canonical_json({"run_id": run_id, "seq": seq, "kind": kind, "payload": payload, "prev_hash": prev_hash})
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


class Run:
    """What load_run returns: verified records, in order."""

    def __init__(self, run_id, protocol, events, checkpoints, alerts):
        self.run_id, self.protocol = run_id, protocol
        self.events: list[Event] = events
        self.checkpoints: list[Checkpoint] = checkpoints
        self.alerts: dict[str, Alert] = alerts  # latest row per alert id

    def branch(self, name: str) -> list[Checkpoint]:
        return [c for c in self.checkpoints if c.branch == name]


class Store:
    def __init__(self, path: str | Path = ":memory:", heads_path: str | Path | None = None):
        self.db = sqlite3.connect(str(path), isolation_level=None)
        self.db.executescript(SCHEMA)
        if heads_path is None and str(path) != ":memory:":
            heads_path = Path(str(path) + ".heads.jsonl")
        self.heads_path = Path(heads_path) if heads_path is not None else None
        self._mem_heads: dict[str, tuple[int, str]] = {}

    # -- head file ------------------------------------------------------------
    def _write_head(self, run_id: str, seq: int, h: str) -> None:
        if self.heads_path is None:
            self._mem_heads[run_id] = (seq, h)
            return
        self.heads_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.heads_path, "a", encoding="utf-8") as f:
            f.write(canonical_json({"run_id": run_id, "seq": seq, "hash": h}) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def recorded_head(self, run_id: str) -> tuple[int, str] | None:
        """The newest head written outside the database for this run."""
        if self.heads_path is None:
            return self._mem_heads.get(run_id)
        if not self.heads_path.exists():
            return None
        head = None
        for n, line in enumerate(self.heads_path.read_text(encoding="utf-8").splitlines(), start=1):
            try:
                d = json.loads(line)
                if d["run_id"] == run_id:
                    head = (int(d["seq"]), str(d["hash"]))
            except (ValueError, KeyError, TypeError) as e:
                raise ChainError(f"head file line {n} is unreadable: {e}") from None
        return head

    def close(self):
        self.db.close()

    # -- writes -------------------------------------------------------------
    def create_run(self, run_id: str, protocol: str, created: float) -> None:
        self.db.execute("INSERT INTO runs VALUES (?,?,?)", (run_id, protocol, created))

    def _append(self, run_id: str, kind: str, payload: dict) -> int:
        if kind not in KINDS:
            raise ValueError(kind)
        text = canonical_json(payload)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            if not self.db.execute("SELECT 1 FROM runs WHERE run_id=?", (run_id,)).fetchone():
                raise KeyError(f"unknown run {run_id}")
            row = self.db.execute("SELECT seq, hash FROM log WHERE run_id=? ORDER BY seq DESC LIMIT 1",
                                  (run_id,)).fetchone()
            seq, prev = (row[0] + 1, row[1]) if row else (1, None)
            h = record_hash(run_id, seq, kind, text, prev)
            self.db.execute("INSERT INTO log VALUES (?,?,?,?,?,?)", (run_id, seq, kind, text, prev, h))
            self._write_head(run_id, seq, h)
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
        return seq

    def append_event(self, run_id: str, event: Event) -> int:
        return self._append(run_id, "event", event.to_dict())

    def add_alert(self, alert: Alert) -> int:
        return self._append(alert.run_id, "alert", alert.to_dict())

    def tip(self, run_id: str, branch: str) -> Checkpoint | None:
        chain = self.load_run(run_id).branch(branch)
        return chain[-1] if chain else None

    def commit_checkpoint(self, cp: Checkpoint, fork_from: str | None = None) -> Checkpoint:
        """Seal cp onto its branch tip and store it. A branch's first checkpoint
        is sealed onto `fork_from` (a checkpoint id on another branch); the
        first checkpoint of 'main' is the genesis."""
        run = self.load_run(cp.run_id)
        chain = run.branch(cp.branch)
        if chain:
            if fork_from is not None:
                raise ValueError(f"branch {cp.branch} already exists")
            parent = chain[-1]
        elif fork_from is not None:
            parent = next((c for c in run.checkpoints if c.id == fork_from), None)
            if parent is None:
                raise KeyError(f"fork point {fork_from} not found")
        elif cp.branch == "main":
            parent = None
        else:
            raise ValueError(f"new branch {cp.branch} needs a fork point")
        if any(c.id == cp.id for c in run.checkpoints):
            raise ValueError(f"checkpoint {cp.id} already stored")
        sealed = seal(cp, parent)
        self._append(cp.run_id, "checkpoint", sealed.to_dict())
        return sealed

    # -- reads ---------------------------------------------------------------
    def head(self, run_id: str) -> tuple[int, str] | None:
        """(seq, hash) of the newest record in the database."""
        row = self.db.execute("SELECT seq, hash FROM log WHERE run_id=? ORDER BY seq DESC LIMIT 1",
                              (run_id,)).fetchone()
        return (row[0], row[1]) if row else None

    def load_run(self, run_id: str, expect_head: tuple[int, str] | None = None) -> Run:
        """Verify and load a run. The newest row must match expect_head if
        given, otherwise the head file's newest line for the run."""
        meta = self.db.execute("SELECT protocol FROM runs WHERE run_id=?", (run_id,)).fetchone()
        if not meta:
            raise KeyError(f"unknown run {run_id}")
        rows = self.db.execute("SELECT run_id, seq, kind, payload, prev_hash, hash FROM log "
                               "WHERE run_id=? ORDER BY seq", (run_id,)).fetchall()
        prev = None
        events, cps, alerts = [], [], {}
        for i, (rid, seq, kind, payload, prev_hash, h) in enumerate(rows, start=1):
            if seq != i:
                raise ChainError(f"run {run_id}: record {i} is missing (found seq {seq})")
            if prev_hash != prev:
                raise ChainError(f"run {run_id}: record {seq} prev_hash does not match record {seq - 1}")
            if h != record_hash(rid, seq, kind, payload, prev_hash):
                raise ChainError(f"run {run_id}: record {seq} was edited: hash mismatch")
            prev = h
            d = json.loads(payload)
            if kind == "event":
                events.append(Event.from_dict(d))
            elif kind == "checkpoint":
                cps.append(Checkpoint.from_dict(d))
            else:
                a = Alert.from_dict(d)
                alerts[a.id] = a
        if expect_head is None:
            expect_head = self.recorded_head(run_id)
            if expect_head is None and rows:
                raise ChainError(f"run {run_id}: no head recorded outside the database")
        if expect_head is not None and (len(rows), prev) != tuple(expect_head):
            raise ChainError(f"run {run_id}: newest record is not the expected head "
                             f"(database has {len(rows)}, head file says {expect_head[0]}): truncated or replaced")
        self._verify_checkpoints(cps)
        return Run(run_id, meta[0], events, cps, alerts)

    @staticmethod
    def _verify_checkpoints(cps: list[Checkpoint]) -> None:
        by_id = {c.id: c for c in cps}
        branches: dict[str, list[Checkpoint]] = {}
        for c in cps:
            branches.setdefault(c.branch, []).append(c)
        for name, chain in branches.items():
            first = chain[0]
            fork = None
            if first.parent_id is not None:
                fork = by_id.get(first.parent_id)
                if fork is None or fork.branch == name:
                    raise ChainError(f"branch {name}: fork point {first.parent_id} not found")
            verify_chain(chain, fork_point=fork)
