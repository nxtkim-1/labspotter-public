# LabSpotter tracking pipeline - provenance and reproduction

## Source footage (native RGB, unannotated)
- Zenodo record 14235875, "Egocentric video clips of laboratory actions", IBM Research - Zurich, DOI 10.5281/zenodo.14235875, open access, published 2024-12-06.
- License: the Zenodo record's Rights field lists CDLA-Permissive-2.0 (checked Nov 3, 2026). The linked IBM code repo https://github.com/IBM/lab-activity-recognition is MIT.
- Record description confirms native rate: "Each clip lasts 4 seconds at 4 frames per second" (16 frames). No higher-fps source exists in the record.
- Zip variants: V = RGB video (1080x1080 or 1600x1200, used here), D = depth map, M = segmentation mask, VG = video + graphics overlay. The app's demo clips were 360p downscales of the V variant.
- Extraction: zenodo_extract.py (HTTP Range into lab-videos.zip, ZIP64 central directory parse, inflate 8 entries). sha256 of expected outputs embedded in the script.

## Detectors (all real, per-frame, local/free, no API calls)
1. Gloved-hand color segmentation (deterministic classical CV):
   - HSV inRange H[82,98] S[110,255] V[40,255]; morph open 5x5, close 21x21;
   - connected components, min area 1.2% of frame, top 2 boxes per frame.
   - Score = min(1, area / 8% of frame) - a size heuristic, NOT a model probability.
2. MediaPipe HandLandmarker (bare-hand coverage):
   - Model: hand_landmarker.task (float16 v1) from
     https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
     sha256 fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1
   - mediapipe 1.2.2 (pip), RunningMode.VIDEO, num_hands=2,
     min_hand_detection_confidence=0.15, min_hand_presence_confidence=0.15,
     min_tracking_confidence=0.15, per-clip fresh tracker (4fps timestamps).
3. OWL-ViT object boxes (precomputed, NOT re-run here):
   - owlvit-base-patch32 open-vocab text queries (gloved hand, human hand,
     wash bottle, test tube, flask, beaker, pipette, spatula, balance,
     separatory funnel), threshold 0.15, per-class NMS, run 2026-10-30 on the
     360p app clips on Kaggle T4 (core agent). Recovered from repo
     app/gui/src/detections.ts @ build/labspotter-integrated.
   - Here: coordinates scaled linearly from 360p to native res; single-frame
     spurious tracks dropped (counted in tracks.json stats).

## Temporal association
- Greedy IoU linking, threshold 0.15, max gap 1 frame, per class
  (hand per box, object per label). No interpolation: boxes exist only on
  frames with a real detection. Track IDs are association labels, not
  verified persistent physical identities.

## Honesty labels
- Hand frame coverage = fraction of frames with >=1 hand detection
  (detector output presence, NOT ground-truth accuracy).
- OWL object labels are unvalidated text-query output; label confusion
  exists (e.g. separatory funnel region tracked as 'flask').
- No_action hand track (5 frames, drifting) is a suspected FALSE hand
  (possibly a resting glove / color artifact), not a verified hand.

## Measured results (16 frames/clip)
- Hand coverage: Add 1.00, AnalyticalMeasurement 1.00, CollectLayer 0.81,
  MeasureLiquid 1.00, MeasureSolid 0.69 (bare hands, MediaPipe only),
  No_action 0.31 (suspected false), PhaseSeparation 0.88, Stir 1.00.
- Stir: two 16-frame hand tracks, spatially consistent (left centerX 0.27-0.45,
  right 0.63-0.83, no crossover); consecutive-frame IoU mean 0.76/0.69,
  min 0.26/0.16 (fast motion at 4fps).

## Run it (paths are arguments)
Files in this folder: track-b2e0814a.py (tracker), make_hands_json.py (MediaPipe
hand boxes), zenodo_extract.py (clip extraction, as used), this note.
1. Clips: native RGB clips as *.mp4 in one folder (see "Source footage").
2. Hand boxes: `python3 make_hands_json.py --src CLIPS_DIR --model hand_landmarker.task --out hands_v.json`
   (model download link and sha256 are listed above; needs mediapipe and opencv, local and free).
   This helper is written from the documented settings; the original one-off step that produced
   the first hands_v.json was not kept as a script, so it is not compared byte-for-byte.
3. OWL boxes: the precomputed JSON from app/gui/detections.json (not re-run here).
4. Track: `python3 track-b2e0814a.py --src CLIPS_DIR --owl detections_owl.json --hands hands_v.json --out OUT_DIR`
   writes OUT_DIR/tracks.json. Defaults are the original working paths (/tmp/src_v,
   /tmp/detections_owl.json, /tmp/track/hands_v.json, /tmp/track/out), kept for reference.
The tracker and make_hands_json.py were syntax-checked and the linking logic was exercised on a
toy case here; the full pipeline has not been re-run end to end in this environment (no OpenCV or MediaPipe installed).
