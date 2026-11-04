#!/usr/bin/env python3
"""Write per-clip MediaPipe hand boxes for track-b2e0814a.py.

Settings are the ones listed in PROVENANCE-tracking.md (hand_landmarker.task
float16 v1, VIDEO mode, num_hands=2, all three confidences 0.15, a fresh
tracker per clip, timestamps from the clip fps). This helper is written from
those documented settings after the original one-off step was lost; it has
not been compared byte-for-byte with the original hands_v.json.

  python3 make_hands_json.py --src CLIPS_DIR --model hand_landmarker.task --out hands_v.json
Needs: pip install mediapipe opencv-python (local, free; no API calls).
"""
import argparse, glob, json, os
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True)
ap.add_argument('--model', default='hand_landmarker.task')
ap.add_argument('--out', default='hands_v.json')
a = ap.parse_args()

res_all = {}
for path in sorted(glob.glob(os.path.join(a.src, '*.mp4'))):
    name = os.path.basename(path)[:-4]
    base = mp_python.BaseOptions(model_asset_path=a.model)
    opts = vision.HandLandmarkerOptions(base_options=base, running_mode=vision.RunningMode.VIDEO,
        num_hands=2, min_hand_detection_confidence=0.15,
        min_hand_presence_confidence=0.15, min_tracking_confidence=0.15)
    lm = vision.HandLandmarker.create_from_options(opts)
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 4.0
    frames = []
    idx = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB))
        r = lm.detect_for_video(img, int(idx * 1000 / fps))
        hands = []
        for k, l in enumerate(r.hand_landmarks):
            hands.append({'bbox': [round(min(p.x for p in l), 4), round(min(p.y for p in l), 4),
                                   round(max(p.x for p in l), 4), round(max(p.y for p in l), 4)],
                          'score': round(r.handedness[k][0].score, 3)})
        frames.append({'f': idx, 'hands': hands})
        idx += 1
    cap.release()
    res_all[name] = {'fps': fps, 'frames': frames}
    print(name, len(frames))
json.dump(res_all, open(a.out, 'w'))
print('saved', a.out)
