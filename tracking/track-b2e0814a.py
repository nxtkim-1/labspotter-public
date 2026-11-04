#!/usr/bin/env python3
"""LabSpotter genuine tracking pipeline (offline, free/local).

Detectors (both real, per-frame, no fabricated boxes):
  H1: MediaPipe HandLandmarker (TASK model, VIDEO mode) -> hand landmark bboxes
  H2: teal-glove HSV color segmentation -> connected-component bboxes
  O1: OWL-ViT base-patch32 open-vocab detections (precomputed on 360p app clips,
      repo app/gui/src/detections.ts) scaled to full-res, per label NMS'd upstream
Fusion: per frame, H2 boxes preferred for gloved hands; H1 fills bare/skin hands.
Temporal association: greedy IoU linking (threshold 0.15, max gap 1) per class.
Tracks shorter than 2 frames dropped as spurious (counted in stats).
NO interpolation: boxes exist only on frames with a real detection; track IDs
are association labels, not verified persistent physical identities.
Outputs: tracks JSON per clip + stats.

Usage (paths are arguments; the defaults are the original working paths):
  python3 track-b2e0814a.py --src CLIPS_DIR --owl detections_owl.json \\
      --hands hands_v.json --out OUT_DIR
  --src    folder of native-resolution *.mp4 clips
  --owl    OWL-ViT detections JSON ({clip: {sourceWidth, sourceHeight, frames:[{boxes:[...]}]}}),
           e.g. exported from app/gui/detections.json
  --hands  per-clip MediaPipe hand boxes ({clip: {frames:[{hands:[{bbox,score}]}]}}),
           written by make_hands_json.py in this folder
  --out    output folder (created if missing); writes tracks.json
"""
import cv2, numpy as np, json, glob, os, sys, argparse

_ap=argparse.ArgumentParser(description='LabSpotter tracking pipeline (offline, local)')
_ap.add_argument('--src', default='/tmp/src_v')
_ap.add_argument('--owl', default='/tmp/detections_owl.json')
_ap.add_argument('--hands', default='/tmp/track/hands_v.json')
_ap.add_argument('--out', default='/tmp/track/out')
_a=_ap.parse_args() if __name__=='__main__' else _ap.parse_args([])
SRC, OWL, MP, OUT = _a.src, _a.owl, _a.hands, _a.out
H_LO, H_HI, S_LO, V_LO = 82, 98, 110, 40
MIN_AREA = 0.012

def glove_boxes(fr):
    h,w=fr.shape[:2]
    hsv=cv2.cvtColor(fr, cv2.COLOR_BGR2HSV)
    m=cv2.inRange(hsv, np.array([H_LO,S_LO,V_LO]), np.array([H_HI,255,255]))
    m=cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5,5),np.uint8))
    m=cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((21,21),np.uint8))
    n,lab,stats,cent=cv2.connectedComponentsWithStats(m)
    out=[]
    for i in range(1,n):
        x,y,bw,bh,area=stats[i]
        if area < MIN_AREA*w*h: continue
        out.append({'xyxy':[x/w,y/h,(x+bw)/w,(y+bh)/h],'score':round(min(1.0,area/(0.08*w*h)),3),'src':'glove-color'})
    return sorted(out,key=lambda b:-(b['xyxy'][2]-b['xyxy'][0])*(b['xyxy'][3]-b['xyxy'][1]))[:2]

def iou(a,b):
    x1,y1=max(a[0],b[0]),max(a[1],b[1]); x2,y2=min(a[2],b[2]),min(a[3],b[3])
    iw,ih=max(0,x2-x1),max(0,y2-y1); inter=iw*ih
    aa=(a[2]-a[0])*(a[3]-a[1]); bb=(b[2]-b[0])*(b[3]-b[1])
    return inter/max(1e-9,aa+bb-inter)

def link_tracks(per_frame, iou_thr=0.15, max_gap=1):
    """per_frame: list of list of det dicts (with xyxy). Returns tracks: list of {id, dets:{f:det}, dropped}."""
    tracks=[]; next_id=0; dropped=0
    active=[]  # (id,last_f,last_box)
    for f,dets in enumerate(per_frame):
        used=set(); newactive=[]
        # greedy match by IoU
        pairs=[]
        for ti,(tid,lf,lb) in enumerate(active):
            for di,d in enumerate(dets):
                pairs.append((iou(lb,d['xyxy']),ti,di))
        pairs.sort(reverse=True)
        matched_t=set(); matched_d=set()
        for ov,ti,di in pairs:
            if ov<iou_thr: break
            if ti in matched_t or di in matched_d: continue
            tid,lf,lb=active[ti]
            if f-lf-1>max_gap: continue
            tracks[tid]['dets'][f]=dets[di]; tracks[tid]['last']=f
            matched_t.add(ti); matched_d.add(di)
            newactive.append((tid,f,dets[di]['xyxy']))
        for di,d in enumerate(dets):
            if di in matched_d: continue
            tracks.append({'id':next_id,'dets':{f:d},'last':f,'label':d.get('label'),'kind':d.get('kind')})
            newactive.append((next_id,f,d['xyxy'])); next_id+=1
        active=newactive
    kept=[]; 
    for t in tracks:
        if len(t['dets'])>=2: kept.append(t)
        else: dropped+=1
    return kept, dropped

owl=json.load(open(OWL))
mphands=json.load(open(MP))
report={}
for path in sorted(glob.glob(f'{SRC}/*.mp4')):
    name=os.path.basename(path)[:-4]
    cap=cv2.VideoCapture(path); fps=cap.get(cv2.CAP_PROP_FPS)
    W=int(cap.get(3)); H=int(cap.get(4))
    owl_clip=owl.get(name)
    ow = owl_clip['sourceWidth'] if owl_clip else W
    oh = owl_clip['sourceHeight'] if owl_clip else H
    sx, sy = W/ow, H/oh
    owl_frames = owl_clip['frames'] if owl_clip else []
    mp_frames = mphands[name]['frames']
    per_hand=[]; per_obj={}
    idx=0
    while True:
        ok,fr=cap.read()
        if not ok: break
        gb=glove_boxes(fr)
        for g in gb: g['kind']='hand'; g['label']='gloved hand'
        mpb=[]
        for hnd in mp_frames[idx]['hands']:
            mpb.append({'xyxy':hnd['bbox'],'score':hnd['score'],'src':'mediapipe','kind':'hand','label':'hand (mediapipe)'})
        hands = gb if gb else mpb  # prefer color glove boxes; mediapipe covers bare hands
        per_hand.append(hands)
        # owl objects this frame (scaled), non-hand only for object tracks; hand-kind owl as evidence count
        if idx < len(owl_frames):
            for b in owl_frames[idx]['boxes']:
                if b['kind']=='hand': continue
                x1,y1,x2,y2=b['xyxy']
                d={'xyxy':[x1/ow,y1/oh,x2/ow,y2/oh],'score':b['score'],'src':'owlvit','kind':'object','label':b['label']}
                per_obj.setdefault(b['label'],[]).append((idx,d))
        idx+=1
    cap.release()
    nframes=idx
    # hand tracks
    htracks, hdrop = link_tracks(per_hand)
    hcov = sum(1 for f in per_hand if f)/nframes
    # object tracks per label
    otracks=[]
    for label,items in per_obj.items():
        pf=[[] for _ in range(nframes)]
        for f,d in items: pf[f].append(d)
        tr,dr=link_tracks(pf)
        for t in tr: t['label']=label
        otracks.append((label,tr,dr,len(items)))
    # stats
    stats={'frames':nframes,'fps':fps,'w':W,'h':H,
           'hand_frame_coverage':round(hcov,3),
           'hand_tracks':[{'id':t['id'],'len':len(t['dets']),'src':list({d['src'] for d in t['dets'].values()})} for t in htracks],
           'hand_dropped_singletons':hdrop,
           'objects':{label:{'raw_dets':n,'tracks':len(tr),'dropped_singletons':dr,
                             'track_lens':sorted([len(t['dets']) for t in tr],reverse=True)[:5]}
                      for label,tr,dr,n in otracks}}
    report[name]={'stats':stats,
                  'hands':[{'id':t['id'],'dets':{str(f):d for f,d in t['dets'].items()}} for t in htracks],
                  'objects':[{'id':t['id'],'label':t['label'],'dets':{str(f):d for f,d in t['dets'].items()}} for _,tr,_,_ in otracks for t in tr]}
    print(name, json.dumps(stats))
os.makedirs(OUT, exist_ok=True)
json.dump(report, open(f'{OUT}/tracks.json','w'))
print('saved', f'{OUT}/tracks.json')
