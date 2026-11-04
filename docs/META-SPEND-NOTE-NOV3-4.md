# Meta Model API test spend, Nov 3 to 4 2026 (this build run only)
Credit only, no card charges. Currency of the credit line is unlabelled (billing is CAD), so treat figures conservatively. Rates used: muse-spark-1.3 $1.25 in / $4.25 out per 1M tokens (https://dev.meta.ai/docs/pricing-rate-limits).
- Benchmark, 5 real calls (5 s video segment as input_video, 4 JPEG frames): reserved total $0.0844, actual about $0.013 from usage.
- In-flow quick look test, 4 real calls (live fake camera, real server route /api/agent/glimpse): reserved $0.0555 (4 x $0.013875), each 200 OK in 4.8 to 5.6 s, usage 1084 input and 460 to 784 output tokens each, actual about $0.015.
- This run total: 9 calls, reserved about $0.14, actual about $0.03.
- Older spend (Nov 1 and Nov 3 earlier) is in META_SPEND_LEDGER and is NOT rolled into this note yet.
- Code cap in chain/agent_entry.py stays 10.0. Every call reserves before it is made.
