"""Event, Checkpoint and Alert contracts (Build Plan, "Contracts").

SWE owns this file; changing a shape needs a spec change. Parsing is strict:
missing or unknown keys and wrong types are rejected, never guessed.

Hash chain: `hash` is the SHA-256 of the canonical JSON (keys sorted, no
whitespace) of the checkpoint without its own `hash` field. `prev_hash` is
the parent's hash. A main-chain genesis checkpoint has parent_id and
prev_hash both null. A branch is a new chain whose first checkpoint has the
fork point as parent_id (and the fork point's hash as prev_hash).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, fields
from typing import Any

CHECKPOINT_STATUSES = ("committed", "failed", "unconfirmed")


class SchemaError(ValueError):
    pass


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _check(cls, data: dict, types: dict) -> dict:
    if not isinstance(data, dict):
        raise SchemaError(f"{cls.__name__}: expected an object")
    names = [f.name for f in fields(cls)]
    missing = [n for n in names if n not in data]
    extra = [k for k in data if k not in names]
    if missing or extra:
        raise SchemaError(f"{cls.__name__}: missing {missing} unknown {extra}")
    for name, kind in types.items():
        v = data[name]
        ok = {
            "str": isinstance(v, str),
            "str?": v is None or isinstance(v, str),
            "num": _num(v),
            "num?": v is None or _num(v),
            "int": isinstance(v, int) and not isinstance(v, bool),
            "int?": v is None or (isinstance(v, int) and not isinstance(v, bool)),
            "bool": isinstance(v, bool),
            "list": isinstance(v, list),
        }[kind]
        if not ok:
            raise SchemaError(f"{cls.__name__}.{name}: expected {kind}, got {type(v).__name__}")
    return data


def _conf(name: str, v) -> None:
    if not 0.0 <= v <= 1.0:
        raise SchemaError(f"{name}: confidence must be 0-1")


# --- Event --------------------------------------------------------------------

@dataclass(frozen=True)
class ObservedEvent:
    t: float
    action: str
    source: str | None
    dest_tube: int | None
    volume_ul: float | None
    step_id: int | None
    confidence: float
    evidence_t: float | None

    @classmethod
    def from_dict(cls, d: dict) -> "ObservedEvent":
        _check(cls, d, {"t": "num", "action": "str", "source": "str?", "dest_tube": "int?",
                        "volume_ul": "num?", "step_id": "int?", "confidence": "num", "evidence_t": "num?"})
        _conf("ObservedEvent", d["confidence"])
        return cls(**d)


@dataclass(frozen=True)
class Event:
    """What one chunk produced."""
    chunk_id: str
    t_start: float
    t_end: float
    events: list[ObservedEvent]
    unexpected: list[Any]
    unobserved: bool

    @classmethod
    def from_dict(cls, d: dict) -> "Event":
        _check(cls, d, {"chunk_id": "str", "t_start": "num", "t_end": "num", "events": "list",
                        "unexpected": "list", "unobserved": "bool"})
        if d["t_end"] < d["t_start"]:
            raise SchemaError("Event: t_end before t_start")
        return cls(**{**d, "events": [ObservedEvent.from_dict(e) for e in d["events"]]})

    def to_dict(self) -> dict:
        return asdict(self)


# --- Checkpoint ----------------------------------------------------------------

@dataclass(frozen=True)
class Content:
    what: str
    ul: float

    @classmethod
    def from_dict(cls, d):
        _check(cls, d, {"what": "str", "ul": "num"})
        return cls(**d)


@dataclass(frozen=True)
class TubeState:
    tube: int
    slot: int
    contents: list[Content]
    mixed: bool
    colour_lab: list[float] | None
    confidence: float
    confirmed: bool
    mask_ref: str | None

    @classmethod
    def from_dict(cls, d):
        _check(cls, d, {"tube": "int", "slot": "int", "contents": "list", "mixed": "bool",
                        "confidence": "num", "confirmed": "bool", "mask_ref": "str?"})
        lab = d["colour_lab"]
        if lab is not None and (not isinstance(lab, list) or len(lab) != 3 or not all(_num(x) for x in lab)):
            raise SchemaError("TubeState.colour_lab: expected [L, a, b] or null")
        _conf("TubeState", d["confidence"])
        return cls(**{**d, "contents": [Content.from_dict(c) for c in d["contents"]]})


@dataclass(frozen=True)
class Note:
    t: float
    text: str
    tube: int | None
    speaker: str | None
    contradicts_video: bool

    @classmethod
    def from_dict(cls, d):
        _check(cls, d, {"t": "num", "text": "str", "tube": "int?", "speaker": "str?",
                        "contradicts_video": "bool"})
        return cls(**d)


@dataclass(frozen=True)
class Evidence:
    kind: str
    t: float
    path: str

    @classmethod
    def from_dict(cls, d):
        _check(cls, d, {"kind": "str", "t": "num", "path": "str"})
        return cls(**d)


@dataclass(frozen=True)
class Checkpoint:
    id: str
    run_id: str
    parent_id: str | None
    branch: str
    step: int
    status: str
    tubes: list[TubeState]
    notes: list[Note]
    evidence: list[Evidence]
    speaker: str | None
    t: float
    prev_hash: str | None
    hash: str | None = field(default=None)

    @classmethod
    def from_dict(cls, d: dict) -> "Checkpoint":
        _check(cls, d, {"id": "str", "run_id": "str", "parent_id": "str?", "branch": "str",
                        "step": "int", "status": "str", "tubes": "list", "notes": "list",
                        "evidence": "list", "speaker": "str?", "t": "num", "prev_hash": "str?",
                        "hash": "str?"})
        if d["status"] not in CHECKPOINT_STATUSES:
            raise SchemaError(f"Checkpoint.status must be one of {CHECKPOINT_STATUSES}")
        return cls(**{**d, "tubes": [TubeState.from_dict(x) for x in d["tubes"]],
                      "notes": [Note.from_dict(x) for x in d["notes"]],
                      "evidence": [Evidence.from_dict(x) for x in d["evidence"]]})

    def to_dict(self) -> dict:
        return asdict(self)


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def checkpoint_hash(cp: Checkpoint | dict) -> str:
    d = cp.to_dict() if isinstance(cp, Checkpoint) else dict(cp)
    d.pop("hash", None)
    return hashlib.sha256(canonical_json(d).encode("utf-8")).hexdigest()


def seal(cp: Checkpoint, parent: Checkpoint | None) -> Checkpoint:
    """Return cp linked to parent (or as a genesis) with its hash filled in."""
    d = cp.to_dict()
    if parent is None:
        d["parent_id"], d["prev_hash"] = None, None
    else:
        if parent.hash is None:
            raise SchemaError("parent is not sealed")
        d["parent_id"], d["prev_hash"] = parent.id, parent.hash
    d["hash"] = None
    d["hash"] = checkpoint_hash(d)
    return Checkpoint.from_dict(d)


class ChainError(ValueError):
    pass


def verify_chain(chain: list[Checkpoint], fork_point: Checkpoint | None = None) -> None:
    """Raise ChainError unless `chain` is an intact, ordered chain.

    Main chain: the first checkpoint is a genesis (no parent, no prev_hash).
    Branch: pass the fork point; the first checkpoint must point at it.
    """
    if not chain:
        raise ChainError("empty chain")
    prev = fork_point
    for i, cp in enumerate(chain):
        if cp.hash != checkpoint_hash(cp):
            raise ChainError(f"checkpoint {cp.id} (position {i}) was edited: hash mismatch")
        if prev is None:
            if cp.parent_id is not None or cp.prev_hash is not None:
                raise ChainError(f"checkpoint {cp.id} is first but is not a genesis")
        else:
            if prev.hash != checkpoint_hash(prev):
                raise ChainError(f"fork point {prev.id} was edited: hash mismatch")
            if cp.parent_id != prev.id:
                raise ChainError(f"checkpoint {cp.id} parent_id {cp.parent_id} != {prev.id}: out of order")
            if cp.prev_hash != prev.hash:
                raise ChainError(f"checkpoint {cp.id} prev_hash does not match {prev.id}")
        if i and cp.branch != chain[0].branch:
            raise ChainError(f"checkpoint {cp.id} switches branch inside one chain")
        prev = cp


# --- Alert ----------------------------------------------------------------------

@dataclass(frozen=True)
class Alert:
    id: str
    run_id: str
    checkpoint_id: str | None
    severity: str
    rule: str
    message: str
    confidence: float
    evidence: list[Evidence]
    blast_radius: list[int]
    status: str

    @classmethod
    def from_dict(cls, d: dict) -> "Alert":
        _check(cls, d, {"id": "str", "run_id": "str", "checkpoint_id": "str?", "severity": "str",
                        "rule": "str", "message": "str", "confidence": "num", "evidence": "list",
                        "blast_radius": "list", "status": "str"})
        _conf("Alert", d["confidence"])
        if not all(isinstance(x, int) and not isinstance(x, bool) for x in d["blast_radius"]):
            raise SchemaError("Alert.blast_radius: expected tube numbers")
        return cls(**{**d, "evidence": [Evidence.from_dict(x) for x in d["evidence"]]})

    def to_dict(self) -> dict:
        return asdict(self)
