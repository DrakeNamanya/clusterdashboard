import json, urllib.request, base64, subprocess, sys, os

# Credentials are read from the environment (never hardcode / commit secrets).
# On the VM, the live copy at /home/ubuntu/ingest_ll.py sets these inline; this
# repo copy expects them exported before running:
#   ODATA_USER, ODATA_PASS, LL_PGPASS
USER=os.environ["ODATA_USER"]
PASS=os.environ["ODATA_PASS"]
VIEW="local_leverage_fund_contribution_form_odata_view"
BASE=f"https://azure.saye-ug.heifer.org/gateway/api/v1/odata-feed/view/{VIEW}/{VIEW}"
TEMPLATE="local_leverage_fund_contribution_form"
PGPASS=os.environ["LL_PGPASS"]

auth = base64.b64encode(f"{USER}:{PASS}".encode()).decode()

def fetch(skip, top=5000):
    url = f"{BASE}?$top={top}&$skip={skip}&$count=true"
    req = urllib.request.Request(url, headers={
        "Authorization": "Basic "+auth,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (LL ingest)"
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

rows = []
skip = 0
total = None
while True:
    d = fetch(skip)
    vals = d.get("value", [])
    if total is None:
        total = d.get("@odata.count")
    if not vals:
        break
    for i, rec in enumerate(vals):
        rec = {k: v for k, v in rec.items() if not k.startswith("@")}
        dk = (rec.get("docId") or "").strip()
        if not dk:
            dk = f"ll-{skip+i}"  # fallback synthetic key
        rows.append((dk, skip+i, json.dumps(rec, ensure_ascii=False)))
    skip += len(vals)
    print(f"fetched {skip}/{total}", file=sys.stderr)
    if total and skip >= total:
        break

print(f"Total rows fetched: {len(rows)}", file=sys.stderr)

# Write a COPY-friendly TSV then load via a temp staging table + upsert.
with open("/tmp/ll_rows.tsv", "w", encoding="utf-8") as f:
    for dk, seq, data in rows:
        dk_e = dk.replace("\\","\\\\").replace("\t"," ").replace("\n"," ").replace("\r"," ")
        data_e = data.replace("\\","\\\\").replace("\t"," ").replace("\n"," ").replace("\r"," ")
        f.write(f"{dk_e}\t{seq}\t{data_e}\n")

sql = f"""
CREATE TEMP TABLE _ll_stg (dedup_key text, seq bigint, data jsonb);
\\copy _ll_stg FROM '/tmp/ll_rows.tsv' WITH (FORMAT text)
DELETE FROM public.records WHERE template='{TEMPLATE}';
INSERT INTO public.records (template, dedup_key, seq, source_file, data)
SELECT '{TEMPLATE}', dedup_key, seq, 'odata:{TEMPLATE}', data
FROM _ll_stg
ON CONFLICT (template, dedup_key) DO UPDATE SET data=EXCLUDED.data, seq=EXCLUDED.seq;
SELECT count(*) AS ingested FROM public.records WHERE template='{TEMPLATE}';
"""
env = dict(os.environ, PGPASSWORD=PGPASS)
p = subprocess.run(["psql","-h","localhost","-U","namanya","-d","defaultdb","-v","ON_ERROR_STOP=1"],
                   input=sql, text=True, env=env, capture_output=True)
print(p.stdout)
print(p.stderr, file=sys.stderr)
sys.exit(p.returncode)
