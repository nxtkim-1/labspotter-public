# Video action chain: measured numbers (development, 2026-11-02; corrects an earlier table)

Flow: 4 s clip (16 frames at 4 fps) -> frozen V-JEPA2 SSv2 checkpoint (facebook/vjepa2-vitl-fpc16-256-ssv2, revision 4aa02df8): encoder last-hidden-state mean h (1024-d) plus the checkpoint's own SSv2 classifier logits lg (174-d), concatenated to 1198-d [h, lg] -> our own trained head (heads/frozen384.pkl, StandardScaler + LogisticRegression; the SSv2 labels themselves are not used as predictions) -> Facts -> Meta agent (offline) -> code gate -> pending_review alert. Model output is a claimed presence only; alerts stay pending_review with no approval recorded; the VALIDATED registry is empty. Nothing here is promoted, deployed or released. The user's stated minimum is 75% accuracy (raw); nothing below reaches it. The TEST split and the 229 validation clips are spent.

| Run | Population / protocol | Raw accuracy | Balanced accuracy |
|---|---|---|---|
| val229, frozen384 head (the selected app head) | 229 official validation clips, 5 sources | not recorded here | 0.512 |
| val229, candidate c003 head (not selected) | same 229 clips | not recorded here | 0.528 |
| val229, full300 route | 229 validation clips | 0.4017 | 0.4967 |
| H2 arm A (one-stage) | 506-clip pilot cohort v1, 3 source-held-out folds | 0.6285 | 0.5515 |
| H2 arm B (two-stage) | same | 0.6166 | 0.5233 |

H2 B minus A balanced = -0.0283 (source-cluster bootstrap interval [-0.0709, +0.0049], descriptive only): no observed gain for B, alternatives not ruled out. Rows use different populations and protocols and are not directly comparable. Per-class recall is uneven; Add is 0.062 on 16 pilot clips from 13 sources.

Correction: an earlier version of this table (in results/ on feat/lab-action-detector, docs/VIDEO_ACTION_CHAIN.md) listed 0.512 as raw and 0.528 as balanced for one "app head". Both numbers are balanced accuracy, for two different heads (frozen384 0.512, c003 0.528).
