#!/usr/bin/env python3
"""
Build the TRUE trainees table (trainees_v2) from the 4 attendance OData feeds
and ingest it via the deployed Worker's /api/trainees-v2/ingest route.

Structure (verified):
  v2 parent  attendance_registration_form_v2_odata_view              54,296 rows, 83 cols
  v2 child   attendance_registration_form_v2.shg_participants_odata  751,258 rows, 12 cols
  v1 parent  attendance_registration_form_odata_view                  3,708 rows, 53 cols
  v1 child   attendance_registration_form.shg_participants_odata      53,854 rows, 12 cols

Join:  child["__Submissions-id"] == parent["docId"]
Union: v1 + v2 (v2 has extra training-detail cols; v1 leaves them blank)
Grain: one row per participant-attendance ("cluster trainings").
       Monthly New Youth = first activity_month per participant (computed on read).

row_key (idempotent, stored-column business key):
  'tv2:' + fnv1a(submission_doc_id | participant_id | training_type | activity_day | child_doc_id)

Why sandbox-side join: parents are small (~58k) so we load them all into a dict,
then stream children page by page and join in memory — the Worker never has to
hold the whole dataset (CPU/mem safe).

Usage:
  python3 scripts/ingest_trainees_v2.py [--version v1|v2|both] [--top 2000]
                                        [--batch 500] [--max-child-pages N] [--dry]
Env: DEPLOY, TOKEN, ODATA_PROFILING_USER, ODATA_PROFILING_PASS (from .dev.vars)
"""
import argparse, base64, json, os, sys, time, urllib.request, urllib.error

DEPLOY = os.environ.get("DEPLOY", "https://shg-data-cleaner.pages.dev")
TOKEN = os.environ.get("TOKEN", "shg-fix-2026")
USER = os.environ.get("ODATA_PROFILING_USER", "")
PASS = os.environ.get("ODATA_PROFILING_PASS", "")
BASE = "https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view"
UA = "Mozilla/5.0 (SHG-Data-Cleaner OData importer)"

FEEDS = {
    "v2_parent": "attendance_registration_form_v2_odata_view/attendance_registration_form_v2_odata_view",
    "v2_child":  "attendance_registration_form_v2.shg_participants_odata_view/attendance_registration_form_v2.shg_participants_odata_view",
    "v1_parent": "attendance_registration_form_odata_view/attendance_registration_form_odata_view",
    "v1_child":  "attendance_registration_form.shg_participants_odata_view/attendance_registration_form.shg_participants_odata_view",
}

# Parent columns we keep (subset of the 83/53). Missing in v1 -> "".
PARENT_KEEP = [
    "district_name", "subcounty_name", "parish", "village", "venue",
    "activity_date", "training_type", "other_training_type", "no_days", "hours",
    "target_group", "financial_literacy", "biz_dev_services", "isla", "animal_mgt",
    "crop_mgt", "gender_safeguarding", "vbhcd", "cornerstone_training", "psrp",
    "incubation_services", "agrihub_training", "sacco_training", "tot_training",
    "life_skills_modules", "mental_health_topics", "srhr_topics",
    "nutrition_training_topics",
]

def fnv1a(s: str) -> str:
    h = 0x811c9dc5
    for ch in s:
        h ^= ord(ch) & 0xFF
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) & 0xFFFFFFFF
    return ("0000000" + format(h, "x"))[-8:]

def norm_day(v):
    s = (v or "").strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return ""

def basic_auth():
    return "Basic " + base64.b64encode(f"{USER}:{PASS}".encode()).decode()

def odata_get(path, top, skip, want_count=False, tries=0):
    """Fetch one OData page. The Heifer gateway flaps (up ~15-30s, then TCP/SSL
    unreachable for minutes), so by default (tries=0) we retry the SAME page
    FOREVER with capped backoff — a multi-minute outage must not lose a page or
    crash the run. Pass tries>0 to bound it."""
    url = f"{BASE}/{path}?$top={top}&$skip={skip}"
    if want_count:
        url += "&$count=true"
    req = urllib.request.Request(url, headers={
        "Authorization": basic_auth(), "Accept": "application/json", "User-Agent": UA})
    attempt = 0
    while True:
        attempt += 1
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                doc = json.loads(r.read().decode("utf-8"))
                return doc.get("value", []), doc.get("@odata.count")
        except Exception as e:
            if tries and attempt >= tries:
                raise RuntimeError(f"odata_get failed {path} skip={skip}: {str(e)[:120]}")
            backoff = min(10 + attempt * 5, 60)  # 15s..60s capped
            if attempt % 5 == 1:
                print(f"    [gateway down] {path} skip={skip} attempt {attempt}: {str(e)[:80]} — retry in {backoff}s", flush=True)
            time.sleep(backoff)

def load_parents(version, top):
    """Return {docId: parent_detail_dict} for the given version."""
    feed = FEEDS[f"{version}_parent"]
    parents = {}
    skip = 0
    total = None
    while True:
        rows, cnt = odata_get(feed, top, skip, want_count=(skip == 0))
        if cnt is not None:
            total = cnt
        if not rows:
            break
        for r in rows:
            doc = (r.get("docId") or "").strip()
            if not doc:
                continue
            parents[doc] = {k: (r.get(k) or "") for k in PARENT_KEEP}
        skip += len(rows)
        print(f"    {version} parents: {len(parents)}/{total}", flush=True)
        if total is not None and skip >= total:
            break
        if len(rows) < top:
            break
    return parents

def post_batch(rows):
    body = json.dumps({"rows": rows}).encode("utf-8")
    req = urllib.request.Request(
        f"{DEPLOY}/api/trainees-v2/ingest?token={TOKEN}", data=body,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (tv2-ingest)"},
        method="POST")
    for attempt in range(1, 6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == 5:
                return {"error": str(e)[:160]}
            time.sleep(attempt * 3)

def build_row(version, child, parent):
    day = norm_day(parent.get("activity_date"))
    month = day[:7] if day else ""
    pid = (child.get("shg_participant_id") or "").strip()
    ttype = (parent.get("training_type") or "").strip()
    sub = (child.get("__Submissions-id") or "").strip()
    cdoc = (child.get("docId") or "").strip()
    key = "tv2:" + fnv1a("\u0001".join([sub, pid, ttype, day, cdoc]))
    return {
        "row_key": key, "form_version": version,
        "submission_doc_id": sub, "child_doc_id": cdoc,
        "participant_name": (child.get("participant_name") or "").strip(),
        "participant_id": pid,
        "sex": (child.get("sex") or "").strip(),
        "is_pwd": 1 if (child.get("shg_disability") or "").strip().lower() == "yes" else 0,
        "district": (parent.get("district_name") or "").strip().upper(),
        "subcounty": (parent.get("subcounty_name") or "").strip(),
        "parish": (parent.get("parish") or "").strip(),
        "village": (parent.get("village") or "").strip(),
        "venue": (parent.get("venue") or "").strip(),
        "activity_date": (parent.get("activity_date") or "").strip(),
        "activity_day": day, "activity_month": month,
        "training_type": ttype,
        "other_training_type": (parent.get("other_training_type") or "").strip(),
        "no_days": (parent.get("no_days") or "").strip(),
        "hours": (parent.get("hours") or "").strip(),
        "target_group": (parent.get("target_group") or "").strip(),
        "financial_literacy": parent.get("financial_literacy") or "",
        "biz_dev_services": parent.get("biz_dev_services") or "",
        "isla": parent.get("isla") or "",
        "animal_mgt": parent.get("animal_mgt") or "",
        "crop_mgt": parent.get("crop_mgt") or "",
        "gender_safeguarding": parent.get("gender_safeguarding") or "",
        "vbhcd": parent.get("vbhcd") or "",
        "cornerstone_training": parent.get("cornerstone_training") or "",
        "psrp": parent.get("psrp") or "",
        "incubation_services": parent.get("incubation_services") or "",
        "agrihub_training": parent.get("agrihub_training") or "",
        "sacco_training": parent.get("sacco_training") or "",
        "tot_training": parent.get("tot_training") or "",
        "life_skills_modules": parent.get("life_skills_modules") or "",
        "mental_health_topics": parent.get("mental_health_topics") or "",
        "srhr_topics": parent.get("srhr_topics") or "",
        "nutrition_training_topics": parent.get("nutrition_training_topics") or "",
        "date_created": (child.get("dateCreated") or "").strip(),
        "source_feed": f"{version}_child",
    }

def process_version(version, top, batch, max_child_pages, dry, skip_start=0):
    print(f"=== {version}: loading parents ===", flush=True)
    parents = load_parents(version, top)
    print(f"=== {version}: {len(parents)} parents loaded; streaming children (from skip={skip_start}) ===", flush=True)
    feed = FEEDS[f"{version}_child"]
    skip = skip_start
    page = 0
    total = None
    sent = 0
    up_total = 0
    orphans = 0
    buf = []
    t0 = time.time()

    def flush():
        nonlocal sent, up_total, buf
        if not buf:
            return
        if dry:
            up_total += 0
        else:
            res = post_batch(buf)
            if "error" in res:
                print(f"  batch@{sent} ERROR {res['error']}", file=sys.stderr, flush=True)
            else:
                up_total += int(res.get("upserted", 0))
                print(f"  {version} children {sent}-{sent+len(buf)-1}: upserted={res.get('upserted')} total={res.get('totalRows')} orphans={orphans} ({round(time.time()-t0)}s)", flush=True)
        sent += len(buf)
        buf = []

    while True:
        rows, cnt = odata_get(feed, top, skip, want_count=(skip == 0))
        if cnt is not None:
            total = cnt
        if not rows:
            break
        for ch in rows:
            sub = (ch.get("__Submissions-id") or "").strip()
            p = parents.get(sub)
            if p is None:
                orphans += 1
                p = {}   # keep the attendance even if header missing
            buf.append(build_row(version, ch, p))
            if len(buf) >= batch:
                flush()
        skip += len(rows)
        page += 1
        if total is not None and skip >= total:
            break
        if len(rows) < top:
            break
        if max_child_pages and page >= max_child_pages:
            print(f"  (stopping {version} at max_child_pages={max_child_pages})", flush=True)
            break
    flush()
    print(f"DONE {version}: children_sent={sent} new_upserted={up_total} orphans={orphans} elapsed={round(time.time()-t0)}s", flush=True)
    return sent, up_total

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", choices=["v1", "v2", "both"], default="both")
    ap.add_argument("--top", type=int, default=2000)
    ap.add_argument("--batch", type=int, default=500)
    ap.add_argument("--max-child-pages", type=int, default=0)
    ap.add_argument("--skip-start", type=int, default=0, help="resume children from this $skip")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    if not USER or not PASS:
        print("ERROR: ODATA_PROFILING_USER/PASS not set", file=sys.stderr)
        sys.exit(2)
    versions = ["v1", "v2"] if args.version == "both" else [args.version]
    grand_sent = grand_up = 0
    for idx, v in enumerate(versions):
        # skip_start only applies to the FIRST version processed (resume point).
        ss = args.skip_start if idx == 0 else 0
        s, u = process_version(v, args.top, args.batch, args.max_child_pages, args.dry, skip_start=ss)
        grand_sent += s
        grand_up += u
    print(f"ALL DONE: sent={grand_sent} new_upserted={grand_up}", flush=True)

if __name__ == "__main__":
    main()
