"""Builds app/data/census.json: Census 2011 households and population for each present-day postal district.

Source: Census of India 2011, Primary Census Abstract, India & States/UTs, state and district level
(DDW_PCA0000_2011_Indiastatedist.xlsx, catalogue 6191 at censusindia.gov.in/nada). See data/SOURCES.md.

Usage: python3 data/build_census.py <DDW_PCA0000_2011_Indiastatedist.xlsx>

District names changed and many districts were split after 2011. Each postal district (from app/data/pins.json)
is matched to a 2011 district in its state: exact name, then a known rename, then a close spelling (ratio >= 0.84).
Districts created after 2011 stay unmatched; the app then reports demand as not loaded for them.
"""
import json, re, sys, difflib, collections
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parent.parent
src = sys.argv[1] if len(sys.argv) > 1 else sys.exit('Usage: python3 data/build_census.py <xlsx>')

rows = list(openpyxl.load_workbook(src, read_only=True)['Sheet1'].iter_rows(values_only=True))
head, rows = rows[0], rows[1:]
col = {h: i for i, h in enumerate(head)}
state_name = {r[0]: r[col['Name']].strip() for r in rows if r[col['Level']] == 'STATE'}
census = collections.defaultdict(dict)  # census state -> district -> {Total, Rural, Urban: (households, population)}
for r in rows:
    if r[col['Level']] != 'DISTRICT':
        continue
    d = census[state_name[r[0]]].setdefault(r[col['Name']].strip(), {})
    d[r[col['TRU']]] = (int(r[col['No_HH']]), int(r[col['TOT_P']]))

norm = lambda s: re.sub(r'[^a-z]', '', s.lower().replace('&', 'and').replace('24', ''))

# Postal state -> 2011 state(s) whose districts it may contain.
STATE = {
    'Delhi': ['NCT OF DELHI'], 'Telangana': ['ANDHRA PRADESH'], 'Ladakh': ['JAMMU & KASHMIR'],
    'The Dadra and Nagar Haveli and Daman and Diu': ['DADRA & NAGAR HAVELI', 'DAMAN & DIU'],
}
# Renames since 2011 (present-day postal name -> 2011 Census name), only where the area is the same district.
RENAME = {
    'gurugram': 'Gurgaon', 'nuh': 'Mewat', 'prayagraj': 'Allahabad', 'ayodhya': 'Faizabad', 'amroha': 'Jyotiba Phule Nagar',
    'kasganj': 'Kanshiram Nagar', 'hathras': 'Mahamaya Nagar', 'bhadohi': 'Sant Ravidas Nagar (Bhadohi)', 'sasnagar': 'Sahibzada Ajit Singh Nagar',
    'srimuktsarsahib': 'Muktsar', 'eastnimar': 'Khandwa (East Nimar)', 'khargone': 'Khargone (West Nimar)', 'dantewada': 'Dakshin Bastar Dantewada',
    'kanker': 'Uttar Bastar Kanker', 'raigad': 'Raigarh', 'dang': 'The Dangs', 'paurigarhwal': 'Garhwal', 'haridwar': 'Hardwar',
    'bengaluruurban': 'Bangalore', 'bengalururural': 'Bangalore Rural', 'belagavi': 'Belgaum', 'mysuru': 'Mysore', 'shivamogga': 'Shimoga',
    'vijayapura': 'Bijapur', 'kalaburagi': 'Gulbarga', 'ballari': 'Bellary', 'tuticorin': 'Thoothukkudi', 'hooghly': 'Hugli', 'howrah': 'Haora',
    'coochbehar': 'Koch Bihar', 'paraganasnorth': 'North Twenty Four Parganas', 'paraganassouth': 'South Twenty Four Parganas',
    'medinipureast': 'Purba Medinipur', 'medinipurwest': 'Paschim Medinipur', 'dinajpurdakshin': 'Dakshin Dinajpur', 'dinajpuruttar': 'Uttar Dinajpur',
    'spsrnellore': 'Sri Potti Sriramulu Nellore', 'kamrupmetro': 'Kamrup Metropolitan', 'eastsinghbum': 'Purbi Singhbhum', 'westsinghbhum': 'Pashchimi Singhbhum',
    'beed': 'Bid', 'korea': 'Koriya', 'narsinghpur': 'Narsimhapur', 'dholpur': 'Dhaulpur', 'budgam': 'Badgam', 'poonch': 'Punch', 'shopian': 'Shupiyan',
    'pondicherry': 'Puducherry', 'boudh': 'Baudh', 'sonepur': 'Subarnapur', 'deogarh': 'Debagarh', 'lakshadweepdistrict': 'Lakshadweep',
}
# A close spelling is accepted only when both names carry the same direction words (South East is not South West).
DIRS = re.compile(r'north|south|east|west|purba|purbi|paschim|uttar|dakshin|upper|lower|central')
NEVER = {'sangareddy'}  # close in spelling to a different 2011 district

out, how = [], collections.Counter()
pins = json.loads((ROOT / 'app/data/pins.json').read_text())
postal = sorted({(pins['states'][r[1]], r[2]) for r in pins['rows']})
for st, dist in postal:
    pool = {}
    for cs in STATE.get(st, [s for s in census if norm(s) == norm(st)]):
        for name, v in census.get(cs, {}).items():
            pool[name] = v
    match, kind = None, None
    byn = {norm(k): k for k in pool}
    if norm(dist) in byn:
        match, kind = byn[norm(dist)], 'exact'
    elif norm(dist) in RENAME and RENAME[norm(dist)] in pool:
        match, kind = RENAME[norm(dist)], 'renamed'
    elif norm(dist) not in NEVER:
        close = difflib.get_close_matches(norm(dist), list(byn), n=1, cutoff=0.84)
        if close and sorted(DIRS.findall(norm(dist))) == sorted(DIRS.findall(close[0])):
            match, kind = byn[close[0]], 'spelling'
    how[kind or 'unmatched'] += 1
    if not match:
        continue
    v = pool[match]
    out.append([st, dist, match, kind, v['Total'][0], v['Urban'][0], v['Rural'][0], v['Total'][1]])

doc = {
    'source': 'Census of India 2011, Primary Census Abstract, state and district level (DDW_PCA0000_2011_Indiastatedist.xlsx)',
    'level': 'District (2011 boundaries)', 'year': 2011,
    'columns': ['state', 'district', 'censusDistrict', 'match', 'households', 'householdsUrban', 'householdsRural', 'population'],
    'rows': out,
}
(ROOT / 'app/data/census.json').write_text(json.dumps(doc, ensure_ascii=False))
print(f"{len(postal)} postal districts: {dict(how)}")
