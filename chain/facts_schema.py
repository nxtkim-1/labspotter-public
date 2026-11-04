"""Facts interface: video model -> timestamped facts (may abstain) -> Meta agent protocol check.
A fact is claimed presence from a named model/version; never an event or identity. Unknown stays unknown."""
from dataclasses import dataclass, asdict
import json
@dataclass
class Fact:
    claim: str            # model-vocabulary label, e.g. "Holding [something] over [something]"
    t_start: float
    t_end: float
    model: str            # e.g. "facebook/vjepa2-vitl-fpc16-256-ssv2@4aa02df8"
    score: float|None     # model probability, not calibrated
    status: str = "unvalidated_model_claim"   # unvalidated_model_claim | unknown | abstain  (never "observed": no classifier here is validated)
    mapping: str = "native"    # native | documented_not_byte_proven
def from_vjepa(path, model, top_k=1):
    out=[]
    for r in json.load(open(path)):
        for lab,p in r["top3"][:top_k]:
            out.append(asdict(Fact(lab,r["t"]-2,r["t"]+2,model,p)))
    return out
if __name__=="__main__":
    import sys; print(json.dumps(from_vjepa(sys.argv[1],"facebook/vjepa2-vitl-fpc16-256-ssv2@4aa02df8"),indent=1)[:600])

# Registry of (model, claim) pairs with a passed matched-action validation. EMPTY on purpose:
# FineBio VideoMAE and V-JEPA SSv2 both failed/unvalidated on the NatureClip development test.
VALIDATED: set = set()
def agent_view(fact: dict) -> dict:
    """What the Meta agent may see. Unvalidated claims stay labelled; they can never become step evidence."""
    ok=(fact["model"],fact["claim"]) in VALIDATED and fact["status"]!="abstain"
    return {**fact,"may_support_step_completion":ok,
            "agent_note":None if ok else "model-predicted label only; not an observed action; cannot complete or verify a protocol step"}
def protocol_step_status(facts, step_claims):
    """Step is COMPLETED only if validated facts cover it; otherwise UNVERIFIED (never inferred)."""
    views=[agent_view(f) for f in facts]
    return {c:("COMPLETED" if any(v["claim"]==c and v["may_support_step_completion"] for v in views) else "UNVERIFIED") for c in step_claims}
