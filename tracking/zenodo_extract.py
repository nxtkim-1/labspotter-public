#!/usr/bin/env python3
"""Deterministic extraction of LabSpotter's 8 demo clips (RGB 'V' variant)
from Zenodo record 14235875 (IBM Research - Zurich, 'Egocentric video clips
of laboratory actions', DOI 10.5281/zenodo.14235875).

Uses HTTP Range requests against lab-videos.zip (33.5 GB): parses the ZIP64
central directory and inflates only the 8 needed entries (deflate).
No credentials needed; record is open access.

Expected sha256 of extracted files (verify after run):
  Add_step.mp4                     e3a4f20d41e71bc14d84c78c6af2ee39739e4f25b65df6039d66cb59f2d7f415
  AnalyticalMeasurement_step.mp4   e770ca60d2589ac896475bb22e40a54dfe4b8c74679fe064ab2919189020f6db
  CollectLayer_step.mp4            fe63b98de6ad4075fa65a7d9cb18108b730c72403c410677b4d72a5a77f566ff
  MeasureLiquid_step.mp4           68ecf4c650efa4f2e7d21d71c4e5e133a2a4aa924d1fae98e496aa8d8a626948
  MeasureSolid_step.mp4            87499ba6e8f0bac512613037952279aeea7903da8c5958f1c208688ab9274a92
  No_action.mp4                    2334d7ce6bcdc7a3918f6d08d211dfae414d8dd4b6ac61ee2df32a63d775bd72
  PhaseSeparation_step.mp4         8e784714855f92dc27cbcff64ebb2a039244513cd704d2ac244ea612b816ae31
  Stir_step.mp4                    42c4b02c68ba92551752dfe2ce22e7652cc98b301111ca0c03e446b467eb6f20

Variants inside the zip: V = RGB video (used here), D = depth map,
M = segmentation mask, VG = video+graphics overlay.
Dataset native rate: 4 s clips at 4 fps, 16 frames (per record description).
"""
import json, urllib.request, struct, zlib, sys, os

URL='https://zenodo.org/api/records/14235875/files/lab-videos.zip/content'
SIZE=33567080469
TARGETS=[('Add_step','bc478aea-45c4-4e34-95e2-886017f533d3_1_2'),
('AnalyticalMeasurement_step','ec627fac-9c55-4dc2-ac0e-8168b819bd99_0_30'),
('CollectLayer_step','ec627fac-9c55-4dc2-ac0e-8168b819bd99_0_37'),
('MeasureLiquid_step','bc478aea-45c4-4e34-95e2-886017f533d3_0_22'),
('MeasureSolid_step','6596c976-1e6b-49fe-96fb-feee2a7f4736_0_1'),
('No_action','c98756a9-5bde-4c6a-a7be-be38fcae334c_1_12'),
('PhaseSeparation_step','3409c87e-ab61-4027-93ab-02d6c3d4f54c_1_12'),
('Stir_step','e5bbb468-50c6-485b-bce7-4a6e3557667a_0_24')]

def fetch(off,n):
    req=urllib.request.Request(URL, headers={'Range':f'bytes={off}-{off+n-1}'})
    return urllib.request.urlopen(req, timeout=120).read()

def central_directory():
    tail=fetch(SIZE-4*1024*1024, 4*1024*1024)
    i=tail.rfind(b'PK\x06\x07'); assert i>0
    eocd64_off=struct.unpack('<Q', tail[i+8:i+16])[0]
    e=fetch(eocd64_off,56); assert e[:4]==b'PK\x06\x06'
    cd_size,cd_off=struct.unpack('<QQ', e[40:56])
    cd=fetch(cd_off,cd_size)
    entries={}; p=0
    while p<len(cd):
        assert cd[p:p+4]==b'PK\x01\x02'
        method,=struct.unpack('<H',cd[p+10:p+12])
        csize,usize=struct.unpack('<II',cd[p+20:p+28])
        lho,=struct.unpack('<I',cd[p+42:p+46])
        nlen,elen,clen=struct.unpack('<HHH',cd[p+28:p+34])
        name=cd[p+46:p+46+nlen].decode()
        extra=cd[p+46+nlen:p+46+nlen+elen]
        if usize==0xFFFFFFFF or csize==0xFFFFFFFF or lho==0xFFFFFFFF:
            q=0
            while q<len(extra):
                hid,hlen=struct.unpack('<HH',extra[q:q+4]); qq=q+4
                if hid==1:
                    if usize==0xFFFFFFFF: usize,=struct.unpack('<Q',extra[qq:qq+8]); qq+=8
                    if csize==0xFFFFFFFF: csize,=struct.unpack('<Q',extra[qq:qq+8]); qq+=8
                    if lho==0xFFFFFFFF: lho,=struct.unpack('<Q',extra[qq:qq+8]); qq+=8
                q+=4+hlen
        entries[name]=(method,csize,usize,lho)
        p+=46+nlen+elen+clen
    return entries

def extract(entries, arcname, outpath):
    method,csize,usize,lho=entries[arcname]
    lh=fetch(lho,30); assert lh[:4]==b'PK\x03\x04'
    nlen,elen=struct.unpack('<HH', lh[26:30])
    data=fetch(lho+30+nlen+elen, csize)
    raw=zlib.decompress(data,-15) if method==8 else data
    assert len(raw)==usize
    open(outpath,'wb').write(raw)

if __name__=='__main__':
    outdir=sys.argv[1] if len(sys.argv)>1 else '.'
    entries=central_directory()
    for label,key in TARGETS:
        arc=f'lab-actions/V/{key}.mp4'
        extract(entries, arc, os.path.join(outdir, f'{label}.mp4'))
        print('extracted', arc)
