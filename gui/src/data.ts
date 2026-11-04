export const LABSPOTTER = {
 "run": {
  "name": "Integration run fresh1",
  "at": "2026-10-30 22:08 EDT",
  "mode": "recorded-video demo",
  "pipeline": [
   "V-JEPA2 (frozen) + linear head",
   "Facts",
   "Meta agent",
   "code gate",
   "pending_review"
  ],
  "seenTestAcc": 0.516,
  "targetAcc": 0.75,
  "targetMet": false,
  "durationS": 32,
  "model": "facebook/vjepa2-vitl-fpc16-256-ssv2@4aa02df8 + head (encoder-feature probe)",
  "attribution": "Clips: IBM Research Zurich, Zenodo 14235875, CDLA-Permissive-2.0",
  "alert": "act-fresh1-1793412445-a0 pending_review",
  "approval": "NONE RECORDED",
  "overclaims": 0
 },
 "clips": [
  {
   "id": "c1",
   "n": 1,
   "t": 0,
   "tEnd": 4,
   "actual": "Add step",
   "predicted": "PhaseSeparation step",
   "confidence": 0.258,
   "top3": [
    [
     "PhaseSeparation step",
     0.258
    ],
    [
     "MeasureLiquid step",
     0.2
    ],
    [
     "No action",
     0.19
    ]
   ],
   "correct": false,
   "video": "clips/Add_step.mp4",
   "poster": "clips/Add_step.jpg",
   "sourceClip": "Add_step__bc478aea-45c4-4e34-95e2-886017f533d3_1_2.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:PhaseSeparation step",
     "score": 0.258,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:MeasureLiquid step",
     "score": 0.2,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:No action",
     "score": 0.19,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "observe Add step",
   "gate": "UNVERIFIED"
  },
  {
   "id": "c2",
   "n": 2,
   "t": 4,
   "tEnd": 8,
   "actual": "AnalyticalMeasurement step",
   "predicted": "AnalyticalMeasurement step",
   "confidence": 0.729,
   "top3": [
    [
     "AnalyticalMeasurement step",
     0.729
    ],
    [
     "Add step",
     0.158
    ],
    [
     "CollectLayer step",
     0.053
    ]
   ],
   "correct": true,
   "video": "clips/AnalyticalMeasurement_step.mp4",
   "poster": "clips/AnalyticalMeasurement_step.jpg",
   "sourceClip": "AnalyticalMeasurement_step__ec627fac-9c55-4dc2-ac0e-8168b819bd99_0_30.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:AnalyticalMeasurement step",
     "score": 0.729,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:Add step",
     "score": 0.158,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:CollectLayer step",
     "score": 0.053,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "observe AnalyticalMeasurement step",
   "gate": "UNVERIFIED"
  },
  {
   "id": "c3",
   "n": 3,
   "t": 8,
   "tEnd": 12,
   "actual": "CollectLayer step",
   "predicted": "CollectLayer step",
   "confidence": 0.475,
   "top3": [
    [
     "CollectLayer step",
     0.475
    ],
    [
     "PhaseSeparation step",
     0.405
    ],
    [
     "No action",
     0.04
    ]
   ],
   "correct": true,
   "video": "clips/CollectLayer_step.mp4",
   "poster": "clips/CollectLayer_step.jpg",
   "sourceClip": "CollectLayer_step__ec627fac-9c55-4dc2-ac0e-8168b819bd99_0_37.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:CollectLayer step",
     "score": 0.475,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:PhaseSeparation step",
     "score": 0.405,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:No action",
     "score": 0.04,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "observe CollectLayer step",
   "gate": "UNVERIFIED"
  },
  {
   "id": "c4",
   "n": 4,
   "t": 12,
   "tEnd": 16,
   "actual": "MeasureLiquid step",
   "predicted": "Add step",
   "confidence": 0.382,
   "top3": [
    [
     "Add step",
     0.382
    ],
    [
     "MeasureLiquid step",
     0.251
    ],
    [
     "AnalyticalMeasurement step",
     0.124
    ]
   ],
   "correct": false,
   "video": "clips/MeasureLiquid_step.mp4",
   "poster": "clips/MeasureLiquid_step.jpg",
   "sourceClip": "MeasureLiquid_step__bc478aea-45c4-4e34-95e2-886017f533d3_0_22.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:Add step",
     "score": 0.382,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:MeasureLiquid step",
     "score": 0.251,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:AnalyticalMeasurement step",
     "score": 0.124,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "observe MeasureLiquid step",
   "gate": "UNVERIFIED"
  },
  {
   "id": "c5",
   "n": 5,
   "t": 16,
   "tEnd": 20,
   "actual": "MeasureSolid step",
   "predicted": "MeasureSolid step",
   "confidence": 0.732,
   "top3": [
    [
     "MeasureSolid step",
     0.732
    ],
    [
     "Add step",
     0.213
    ],
    [
     "Stir step",
     0.018
    ]
   ],
   "correct": true,
   "video": "clips/MeasureSolid_step.mp4",
   "poster": "clips/MeasureSolid_step.jpg",
   "sourceClip": "MeasureSolid_step__6596c976-1e6b-49fe-96fb-feee2a7f4736_0_1.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:MeasureSolid step",
     "score": 0.732,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:Add step",
     "score": 0.213,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:Stir step",
     "score": 0.018,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "observe MeasureSolid step",
   "gate": "UNVERIFIED"
  },
  {
   "id": "c6",
   "n": 6,
   "t": 20,
   "tEnd": 24,
   "actual": "No action",
   "predicted": "CollectLayer step",
   "confidence": 0.478,
   "top3": [
    [
     "CollectLayer step",
     0.478
    ],
    [
     "Stir step",
     0.151
    ],
    [
     "MeasureLiquid step",
     0.106
    ]
   ],
   "correct": false,
   "video": "clips/No_action.mp4",
   "poster": "clips/No_action.jpg",
   "sourceClip": "No_action__c98756a9-5bde-4c6a-a7be-be38fcae334c_1_12.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:CollectLayer step",
     "score": 0.478,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:Stir step",
     "score": 0.151,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:MeasureLiquid step",
     "score": 0.106,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "observe PhaseSeparation step",
   "gate": "UNVERIFIED"
  },
  {
   "id": "c7",
   "n": 7,
   "t": 24,
   "tEnd": 28,
   "actual": "PhaseSeparation step",
   "predicted": "Add step",
   "confidence": 0.499,
   "top3": [
    [
     "Add step",
     0.499
    ],
    [
     "No action",
     0.142
    ],
    [
     "CollectLayer step",
     0.127
    ]
   ],
   "correct": false,
   "video": "clips/PhaseSeparation_step.mp4",
   "poster": "clips/PhaseSeparation_step.jpg",
   "sourceClip": "PhaseSeparation_step__3409c87e-ab61-4027-93ab-02d6c3d4f54c_1_12.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:Add step",
     "score": 0.499,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:No action",
     "score": 0.142,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:CollectLayer step",
     "score": 0.127,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "observe Stir step",
   "gate": "UNVERIFIED"
  },
  {
   "id": "c8",
   "n": 8,
   "t": 28,
   "tEnd": 32,
   "actual": "Stir step",
   "predicted": "Add step",
   "confidence": 0.51,
   "top3": [
    [
     "Add step",
     0.51
    ],
    [
     "AnalyticalMeasurement step",
     0.415
    ],
    [
     "Stir step",
     0.036
    ]
   ],
   "correct": false,
   "video": "clips/Stir_step.mp4",
   "poster": "clips/Stir_step.jpg",
   "sourceClip": "Stir_step__e5bbb468-50c6-485b-bce7-4a6e3557667a_0_24.mp4",
   "decodedFrames": 16,
   "claims": [
    {
     "claim": "lab_action:Add step",
     "score": 0.51,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:AnalyticalMeasurement step",
     "score": 0.415,
     "status": "unvalidated_model_claim"
    },
    {
     "claim": "lab_action:Stir step",
     "score": 0.036,
     "status": "unvalidated_model_claim"
    }
   ],
   "gateStep": "",
   "gate": "UNVERIFIED"
  }
 ]
};
