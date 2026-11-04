import json
from facts_schema import *
M="m@1"
def F(c,st="unvalidated_model_claim"): return {"claim":c,"t_start":0,"t_end":4,"model":M,"score":.99,"status":st,"mapping":"native"}
def test_default_status_not_observed(): assert Fact("x",0,1,"m",.5).status=="unvalidated_model_claim"
def test_high_score_cannot_complete_step(): assert protocol_step_status([F("Holding [something] over [something]")],["Holding [something] over [something]"])=={"Holding [something] over [something]":"UNVERIFIED"}
def test_status_observed_string_cannot_launder(): assert protocol_step_status([F("a","observed")],["a"])["a"]=="UNVERIFIED"
def test_empty_facts_unverified(): assert protocol_step_status([],["a"])["a"]=="UNVERIFIED"
def test_validated_only_via_registry():
    VALIDATED.add((M,"a")); assert protocol_step_status([F("a")],["a"])["a"]=="COMPLETED"
    assert protocol_step_status([F("a","abstain")],["a"])["a"]=="UNVERIFIED"; VALIDATED.clear()
def test_note_present(): assert agent_view(F("a"))["agent_note"]
