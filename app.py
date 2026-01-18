import json
import re
import hashlib
from pathlib import Path
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
from typing import Dict, List, Optional, Any, Tuple
from collections import Counter

import feedparser
from dateutil import parser as dateparser
from rapidfuzz import fuzz
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE = Path(__file__).parent
FEEDS_FILE = BASE / "feeds.json"
SOURCES_FILE = BASE / "sources.json"
DB_FILE = BASE / "db.json"

app = FastAPI(title="OpenGround")
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))


# ------------------------
# Utilities
# ------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default

def save_json(path: Path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

def stable_id(*parts: str) -> str:
    s = "|".join([p.strip() for p in parts if p is not None])
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def strip_html(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"<[^>]*>", " ", text).replace("\xa0", " ").strip()

def parse_date(entry) -> Optional[str]:
    for key in ("published", "updated", "created"):
        if key in entry and entry[key]:
            try:
                return dateparser.parse(entry[key]).astimezone(timezone.utc).isoformat()
            except Exception:
                pass
    return None

def domain_of(url: str) -> str:
    try:
        netloc = urlparse(url).netloc.lower()
        netloc = netloc.replace("www.", "")
        return netloc
    except Exception:
        return ""

def norm_title(title: str) -> str:
    """Normalize title for comparison"""
    t = title.lower().strip()
    t = re.sub(r"[\"'""'']", "", t)
    t = re.sub(r"[^\w\s-]", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    stop = set(["the", "a", "an"])
    toks = [w for w in t.split() if w not in stop]
    return " ".join(toks)

def get_comprehensive_stopwords() -> set:
    """Comprehensive list of words to filter from trending topics"""
    return set([
        'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her',
        'its', 'our', 'their', 'all', 'some', 'any', 'each', 'every', 'both', 'few',
        'more', 'most', 'other', 'another', 'such', 'what', 'which', 'who', 'whom',
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
        'must', 'can', 'get', 'make', 'take', 'come', 'go', 'say', 'tell', 'give',
        'find', 'think', 'know', 'want', 'look', 'use', 'seem', 'keep', 'let', 'put',
        'mean', 'leave', 'call', 'ask', 'work', 'try', 'feel', 'become', 'show', 'turn',
        'bring', 'follow', 'begin', 'run', 'hold', 'write', 'stand', 'hear', 'help',
        'play', 'move', 'live', 'believe', 'happen', 'appear', 'continue', 'set',
        'change', 'lead', 'understand', 'watch', 'need', 'add', 'allow', 'spend',
        'grow', 'open', 'walk', 'win', 'offer', 'remember', 'love', 'consider', 'buy',
        'wait', 'serve', 'die', 'send', 'expect', 'build', 'stay', 'fall', 'reach',
        'kill', 'remain', 'suggest', 'raise', 'pass', 'sell', 'require', 'report',
        'decide', 'pull', 'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
        'as', 'into', 'about', 'after', 'before', 'between', 'through', 'during',
        'within', 'without', 'under', 'over', 'above', 'below', 'up', 'down', 'out',
        'off', 'against', 'among', 'around', 'behind', 'beside', 'near', 'across',
        'along', 'toward', 'until', 'upon', 'via', 'and', 'or', 'but', 'nor', 'so',
        'yet', 'also', 'too', 'very', 'then', 'now', 'just', 'only', 'even', 'back',
        'well', 'still', 'again', 'never', 'always', 'often', 'sometimes', 'usually',
        'really', 'why', 'how', 'when', 'where', 'says', 'said', 'according', 'news',
        'latest', 'update', 'breaking', 'live', 'today', 'yesterday', 'tomorrow',
        'tonight', 'morning', 'evening', 'night', 'day', 'week', 'month', 'year',
        'time', 'first', 'second', 'third', 'last', 'next', 'new', 'old', 'good',
        'bad', 'best', 'worst', 'better', 'worse', 'big', 'small', 'large', 'little',
        'long', 'short', 'high', 'low', 'top', 'many', 'much', 'less', 'way', 'thing',
        'people', 'person', 'man', 'woman', 'men', 'women', 'child', 'children', 'life',
        'world', 'country', 'city', 'place', 'home', 'house', 'right', 'left', 'side',
        'end', 'part', 'number', 'case', 'point', 'fact', 'hand', 'eye', 'face', 'like',
        'different', 'same', 'own', 'going', 'doing', 'being', 'having', 'making',
        'getting', 'coming', 'seen', 'saw', 'see', 'looks', 'looked', 'looking',
        'found', 'everything', 'something', 'anything', 'nothing', 'everyone', 'someone',
        'anyone', 'one', 'two', 'three', 'four', 'five', 'video', 'photo', 'image',
        'here', 'there', 'yes', 'yeah', 'okay'
    ])

def extract_keywords(title: str, min_length: int = 4) -> set:
    """Extract meaningful keywords from title"""
    normalized = norm_title(title)
    words = normalized.split()
    stop_words = get_comprehensive_stopwords()
    
    keywords = set()
    for w in words:
        if (len(w) >= min_length and 
            w not in stop_words and 
            not w.isdigit() and
            not all(c.isdigit() or c in ['-', '/', ':'] for c in w)):
            keywords.add(w)
    
    return keywords

def is_meaningful_keyword(keyword: str) -> bool:
    """Validate keywords are meaningful"""
    stop_words = get_comprehensive_stopwords()
    
    if keyword.lower() in stop_words:
        return False
    if len(keyword) < 4:
        return False
    if keyword.isdigit():
        return False
    if keyword.endswith(('ing', 'ed', 'ly', 'er', 'est')) and len(keyword) <= 6:
        return False
    if not any(c in 'aeiou' for c in keyword.lower()):
        return False
    if keyword.isupper() and len(keyword) < 3:
        return False
    
    return True

def similarity(a: str, b: str) -> int:
    return fuzz.token_sort_ratio(a, b)

def keyword_overlap(keywords_a: set, keywords_b: set) -> float:
    if not keywords_a or not keywords_b:
        return 0.0
    intersection = len(keywords_a & keywords_b)
    union = len(keywords_a | keywords_b)
    return intersection / union if union > 0 else 0.0


# ------------------------
# Data loading
# ------------------------
def load_feeds() -> Dict[str, List[str]]:
    return load_json(FEEDS_FILE, {})

def load_sources() -> Dict[str, Any]:
    return load_json(SOURCES_FILE, {})

def load_db() -> Dict[str, Any]:
    return load_json(DB_FILE, {
        "articles": [],
        "seen": {},
        "stories": [],
        "trending_topics": [],
        "last_updated": None
    })

def save_db(db: Dict[str, Any]):
    db["last_updated"] = now_iso()
    save_json(DB_FILE, db)


# ------------------------
# RSS ingestion
# ------------------------
def fetch_articles() -> int:
    feeds = load_feeds()
    db = load_db()
    seen = db["seen"]
    added = 0
    all_new = []

    for category, urls in feeds.items():
        for url in urls:
            print(f"Fetching {url}...")
            try:
                f = feedparser.parse(url)
                source_title = f.feed.get("title", url)
                for e in f.entries[:50]:
                    title = (e.get("title") or "").strip()
                    link = (e.get("link") or "").strip()
                    if not title or not link:
                        continue

                    aid = stable_id(title.lower(), link)
                    if aid in seen:
                        continue

                    item = {
                        "id": aid,
                        "title": title,
                        "title_norm": norm_title(title),
                        "keywords": list(extract_keywords(title)),
                        "link": link,
                        "domain": domain_of(link),
                        "summary": strip_html(e.get("summary") or e.get("description") or ""),
                        "published": parse_date(e),
                        "source_feed": source_title,
                        "category": category,
                        "fetched_at": now_iso()
                    }
                    all_new.append(item)
                    seen[aid] = link
                    added += 1
            except Exception as e:
                print(f"Error fetching {url}: {e}")

    db["articles"].extend(all_new)

    def sort_key(a):
        return a.get("published") or a.get("fetched_at") or ""

    db["articles"].sort(key=sort_key, reverse=True)
    db["articles"] = db["articles"][:3000]
    db["seen"] = seen
    save_db(db)
    print(f"Added {added} new articles")
    return added


# ------------------------
# Trending Topics Detection
# ------------------------
def detect_trending_topics(articles: List[Dict[str, Any]], hours: int = 24) -> List[Dict[str, Any]]:
    """Detect trending topics based on keyword frequency"""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    
    recent = []
    for a in articles:
        pub = a.get("published") or a.get("fetched_at")
        if pub:
            try:
                dt = datetime.fromisoformat(pub.replace('Z', '+00:00'))
                if dt > cutoff:
                    recent.append(a)
            except:
                pass
    
    print(f"Analyzing {len(recent)} recent articles for trending topics...")
    
    keyword_counts = Counter()
    keyword_articles = {}
    
    for a in recent:
        keywords = set(a.get("keywords", []))
        for kw in keywords:
            if not is_meaningful_keyword(kw):
                continue
            
            keyword_counts[kw] += 1
            if kw not in keyword_articles:
                keyword_articles[kw] = []
            keyword_articles[kw].append(a)
    
    trending = []
    for kw, count in keyword_counts.most_common(50):
        if count >= 5:
            articles_with_kw = keyword_articles[kw]
            domains = set([a.get("domain") for a in articles_with_kw if a.get("domain")])
            
            if len(domains) < 3:
                continue
            
            last_6h = datetime.now(timezone.utc) - timedelta(hours=6)
            recent_count = 0
            for a in articles_with_kw:
                pub = a.get("published") or a.get("fetched_at")
                if pub:
                    try:
                        dt = datetime.fromisoformat(pub.replace('Z', '+00:00'))
                        if dt > last_6h:
                            recent_count += 1
                    except:
                        pass
            
            velocity = recent_count / count if count > 0 else 0
            
            seen_domains = set()
            sample_headlines = []
            for a in articles_with_kw[:15]:
                d = a.get("domain")
                if d not in seen_domains:
                    sample_headlines.append(a.get("title"))
                    seen_domains.add(d)
                if len(sample_headlines) >= 5:
                    break
            
            trending.append({
                "keyword": kw,
                "count": count,
                "velocity": velocity,
                "heat_score": count * (1 + velocity * 1.5),
                "sources": len(domains),
                "sample_headlines": sample_headlines,
                "related_articles": len(articles_with_kw)
            })
    
    trending.sort(key=lambda x: x["heat_score"], reverse=True)
    
    print(f"Found {len(trending)} trending topics")
    return trending[:25]


# ------------------------
# Story Timeline Feature
# ------------------------
def get_dominant_bias(distribution: Dict[str, int]) -> str:
    """Determine dominant bias from distribution"""
    if not distribution:
        return "unknown"
    
    total = sum(distribution.values()) or 1
    ratios = {k: v/total for k, v in distribution.items()}
    
    if ratios.get("left", 0) > 0.5:
        return "left-leaning"
    elif ratios.get("right", 0) > 0.5:
        return "right-leaning"
    elif ratios.get("center", 0) > 0.4:
        return "balanced"
    else:
        return "mixed"

def generate_story_timeline(story: Dict[str, Any]) -> Dict[str, Any]:
    """Generate timeline showing how story evolved"""
    articles = story.get("articles", [])
    
    timeline_items = []
    for a in articles:
        pub = a.get("published") or a.get("fetched_at")
        if pub:
            try:
                dt = datetime.fromisoformat(pub.replace('Z', '+00:00'))
                timeline_items.append({
                    "timestamp": pub,
                    "datetime": dt,
                    "title": a.get("title"),
                    "publisher": a.get("publisher_name") or a.get("domain"),
                    "bias_bucket": a.get("bias_bucket", "unknown"),
                    "bias_score": a.get("bias_score", 0.0),
                    "link": a.get("link"),
                    "summary": a.get("summary", "")
                })
            except:
                pass
    
    timeline_items.sort(key=lambda x: x["datetime"])
    
    if not timeline_items:
        return {
            "first_reported_by": None,
            "coverage_span_hours": 0,
            "phases": [],
            "narrative_shifts": [],
            "timeline_items": []
        }
    
    first = timeline_items[0]
    last = timeline_items[-1]
    span_hours = (last["datetime"] - first["datetime"]).total_seconds() / 3600
    
    # Group into 6-hour phases
    phases = []
    current_phase = {
        "start": first["datetime"],
        "articles": [],
        "bias_distribution": {"left": 0, "center": 0, "right": 0, "unknown": 0}
    }
    
    phase_duration = timedelta(hours=6)
    
    for item in timeline_items:
        if item["datetime"] - current_phase["start"] > phase_duration:
            if current_phase["articles"]:
                phases.append(current_phase)
            current_phase = {
                "start": item["datetime"],
                "articles": [],
                "bias_distribution": {"left": 0, "center": 0, "right": 0, "unknown": 0}
            }
        
        current_phase["articles"].append(item)
        bucket = item.get("bias_bucket", "unknown")
        current_phase["bias_distribution"][bucket] += 1
    
    if current_phase["articles"]:
        phases.append(current_phase)
    
    # Detect narrative shifts
    narrative_shifts = []
    for i in range(1, len(phases)):
        prev = phases[i-1]["bias_distribution"]
        curr = phases[i]["bias_distribution"]
        
        prev_total = sum(prev.values()) or 1
        curr_total = sum(curr.values()) or 1
        
        prev_left_ratio = prev.get("left", 0) / prev_total
        curr_left_ratio = curr.get("left", 0) / curr_total
        
        if abs(prev_left_ratio - curr_left_ratio) > 0.3:
            narrative_shifts.append({
                "phase_index": i,
                "description": f"Coverage shifted from {get_dominant_bias(prev)} to {get_dominant_bias(curr)}"
            })
    
    return {
        "first_reported_by": {
            "publisher": first["publisher"],
            "timestamp": first["timestamp"],
            "bias_bucket": first["bias_bucket"],
            "title": first["title"]
        },
        "coverage_span_hours": round(span_hours, 1),
        "total_articles": len(timeline_items),
        "phases": [{
            "phase_number": i + 1,
            "start_time": p["start"].isoformat(),
            "article_count": len(p["articles"]),
            "bias_distribution": p["bias_distribution"],
            "dominant_bias": get_dominant_bias(p["bias_distribution"]),
            "articles": p["articles"]
        } for i, p in enumerate(phases)],
        "narrative_shifts": narrative_shifts,
        "timeline_items": [{
            "timestamp": item["timestamp"],
            "publisher": item["publisher"],
            "bias_bucket": item["bias_bucket"],
            "title": item["title"],
            "link": item["link"]
        } for item in timeline_items]
    }


# ------------------------
# Clustering
# ------------------------
def ensure_title_norm(article: Dict[str, Any]) -> str:
    if "title_norm" not in article or not article["title_norm"]:
        article["title_norm"] = norm_title(article.get("title", ""))
    if "keywords" not in article or not article["keywords"]:
        article["keywords"] = list(extract_keywords(article.get("title", "")))
    return article["title_norm"]

def cluster_stories(
    articles: List[Dict[str, Any]],
    sources: Dict[str, Any],
    max_articles: int = 1000,
    threshold: int = 60,
    keyword_threshold: float = 0.25
) -> List[Dict[str, Any]]:
    """Cluster articles into stories"""
    items = articles[:max_articles]
    
    for item in items:
        ensure_title_norm(item)
    
    stories: List[Dict[str, Any]] = []
    
    print(f"Clustering {len(items)} articles...")

    for idx, a in enumerate(items):
        best_i = -1
        best_s = -1
        a_norm = ensure_title_norm(a)
        a_keywords = set(a.get("keywords", []))

        for i, st in enumerate(stories):
            st_norm = st.get("title_norm", "")
            if not st_norm:
                continue
            
            if a.get("domain") in st.get("domains", set()):
                continue
            
            text_sim = similarity(a_norm, st_norm)
            st_keywords = set(st.get("keywords", []))
            kw_overlap = keyword_overlap(a_keywords, st_keywords)
            combined_score = (text_sim * 0.65) + (kw_overlap * 100 * 0.35)
            
            if combined_score > best_s:
                best_s = combined_score
                best_i = i

        if best_s >= threshold and best_i >= 0:
            st = stories[best_i]
            st["articles"].append(a)
            st["domains"].add(a.get("domain", ""))
            st["keywords"] = list(set(st.get("keywords", [])) | a_keywords)
            st["first_seen"] = min(st["first_seen"], a.get("published") or a.get("fetched_at") or st["first_seen"])
            st["last_seen"] = max(st["last_seen"], a.get("published") or a.get("fetched_at") or st["last_seen"])
            
            if (idx + 1) % 100 == 0:
                print(f"  Processed {idx + 1}/{len(items)}, {len(stories)} stories")
        else:
            stories.append({
                "story_id": stable_id("story", a_norm, a.get("link", "")),
                "title": a.get("title", ""),
                "title_norm": a_norm,
                "keywords": list(a_keywords),
                "category": a.get("category") or "Top",
                "first_seen": a.get("published") or a.get("fetched_at") or "",
                "last_seen": a.get("published") or a.get("fetched_at") or "",
                "articles": [a],
                "domains": set([a.get("domain", "")])
            })

    print(f"Created {len(stories)} stories")

    # Post-process
    out = []
    for st in stories:
        arts = st["articles"]

        by_domain = {}
        for x in arts:
            d = x.get("domain") or ""
            if d not in by_domain:
                by_domain[d] = x
        dedup_arts = list(by_domain.values())

        last_pub = st.get("last_seen")
        freshness = 0.0
        if last_pub:
            try:
                dt = datetime.fromisoformat(last_pub.replace('Z', '+00:00'))
                hours_old = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
                freshness = max(0, 48 - hours_old) / 48
            except:
                pass

        counts = {"left": 0, "center": 0, "right": 0, "unknown": 0}
        score_sum = 0.0
        score_n = 0
        compare = {"left": [], "center": [], "right": [], "unknown": []}

        for x in dedup_arts:
            d = x.get("domain") or ""
            meta = sources.get(d)
            bucket = "unknown"
            sc = 0.0
            name = d

            if meta:
                bucket = meta.get("bias_bucket", "unknown")
                sc = float(meta.get("bias_score", 0.0))
                name = meta.get("name", d)

            x2 = dict(x)
            x2["publisher_name"] = name
            x2["bias_bucket"] = bucket
            x2["bias_score"] = sc

            counts[bucket] = counts.get(bucket, 0) + 1
            if bucket != "unknown":
                score_sum += sc
                score_n += 1

            if len(compare[bucket]) < 3:
                compare[bucket].append(x2)

        bias_score = (score_sum / score_n) if score_n > 0 else 0.0
        total = sum(counts.values()) or 1
        bar = {
            "left": counts["left"] / total,
            "center": counts["center"] / total,
            "right": counts["right"] / total,
            "unknown": counts["unknown"] / total
        }

        if abs(bias_score) < 0.15:
            lean = "Center-ish"
        elif bias_score < 0:
            lean = "Leans Left"
        else:
            lean = "Leans Right"

        rep = st["title"]
        rep_norm = st.get("title_norm", norm_title(rep))
        best_rep_score = -1
        for x in dedup_arts[:12]:
            x_norm = ensure_title_norm(x)
            s = similarity(rep_norm, x_norm)
            if s > best_rep_score:
                best_rep_score = s
                rep = x.get("title", rep)

        out.append({
            "story_id": st["story_id"],
            "title": rep,
            "category": st.get("category") or "Top",
            "first_seen": st["first_seen"],
            "last_seen": st["last_seen"],
            "coverage": len(dedup_arts),
            "freshness": freshness,
            "bias_bar": bar,
            "bias_score": bias_score,
            "lean": lean,
            "compare": compare,
            "articles": sorted(dedup_arts, key=lambda z: z.get("published") or z.get("fetched_at") or "", reverse=True)
        })

    print(f"Final: {len(out)} stories")

    def st_key(s):
        return (s.get("freshness", 0) * s.get("coverage", 1), s.get("last_seen") or "")

    out.sort(key=st_key, reverse=True)
    return out


def rebuild_stories() -> int:
    db = load_db()
    sources = load_sources()
    
    for article in db["articles"]:
        ensure_title_norm(article)
    
    stories = cluster_stories(db["articles"], sources)
    db["stories"] = stories
    db["trending_topics"] = detect_trending_topics(db["articles"])
    
    save_db(db)
    return len(stories)


def refresh_all() -> Dict[str, Any]:
    added = fetch_articles()
    story_count = rebuild_stories()
    return {"added_articles": added, "stories": story_count, "updated_at": now_iso()}


# ------------------------
# Blindspots
# ------------------------
def compute_blindspots(stories: List[Dict[str, Any]], min_cov: int = 4) -> List[Dict[str, Any]]:
    results = []
    for s in stories:
        if s.get("coverage", 0) < min_cov:
            continue
        bar = s.get("bias_bar", {})
        left, center, right = bar.get("left", 0), bar.get("center", 0), bar.get("right", 0)

        if left < 0.15 and right >= 0.35:
            kind = "Left blindspot"
        elif right < 0.15 and left >= 0.35:
            kind = "Right blindspot"
        else:
            continue

        results.append({
            "story_id": s["story_id"],
            "title": s["title"],
            "coverage": s["coverage"],
            "bias_bar": s["bias_bar"],
            "bias_score": s["bias_score"],
            "lean": s["lean"],
            "kind": kind,
            "last_seen": s.get("last_seen")
        })

    results.sort(key=lambda x: (x.get("last_seen") or "", x.get("coverage") or 0), reverse=True)
    return results


# ------------------------
# Pages
# ------------------------
@app.get("/", response_class=HTMLResponse)
def page_home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/story/{story_id}", response_class=HTMLResponse)
def page_story(story_id: str, request: Request):
    return templates.TemplateResponse("story.html", {"request": request, "story_id": story_id})

@app.get("/blindspots", response_class=HTMLResponse)
def page_blindspots(request: Request):
    return templates.TemplateResponse("blindspots.html", {"request": request})

@app.get("/trending", response_class=HTMLResponse)
def page_trending(request: Request):
    return templates.TemplateResponse("trending.html", {"request": request})


# ------------------------
# APIs
# ------------------------
@app.post("/api/refresh")
def api_refresh():
    """Refresh articles and rebuild stories"""
    data = refresh_all()
    return JSONResponse({"ok": True, **data})

@app.get("/api/meta")
def api_meta():
    """Get metadata about the database"""
    db = load_db()
    return JSONResponse({
        "last_updated": db.get("last_updated"),
        "stories": len(db.get("stories", [])),
        "articles": len(db.get("articles", [])),
        "trending_topics": len(db.get("trending_topics", []))
    })

@app.get("/api/categories")
def api_categories():
    """Get all available categories"""
    feeds = load_feeds()
    cats = sorted(set(["All"] + list(feeds.keys())))
    return JSONResponse({"categories": cats})

@app.get("/api/stories")
def api_stories(category: str = "All", q: str = "", limit: int = 60, offset: int = 0):
    """Get stories with optional filtering"""
    db = load_db()
    stories = db.get("stories", [])

    if category and category != "All":
        stories = [s for s in stories if s.get("category") == category]

    if q.strip():
        qq = q.strip().lower()
        stories = [s for s in stories if qq in (s.get("title") or "").lower()]

    limit = max(1, min(limit, 120))
    offset = max(0, offset)
    slice_ = stories[offset: offset + limit]

    return JSONResponse({
        "last_updated": db.get("last_updated"),
        "total": len(stories),
        "items": [{
            "story_id": s["story_id"],
            "title": s["title"],
            "category": s["category"],
            "coverage": s["coverage"],
            "freshness": s.get("freshness", 0),
            "bias_bar": s["bias_bar"],
            "bias_score": s["bias_score"],
            "lean": s["lean"],
            "last_seen": s.get("last_seen"),
        } for s in slice_]
    })

@app.get("/api/story/{story_id}")
def api_story(story_id: str):
    """Get detailed information about a specific story"""
    db = load_db()
    for s in db.get("stories", []):
        if s.get("story_id") == story_id:
            return JSONResponse(s)
    return JSONResponse({"error": "not_found"}, status_code=404)

@app.get("/api/story/{story_id}/timeline")
def api_story_timeline(story_id: str):
    """Get detailed timeline for a specific story"""
    db = load_db()
    for s in db.get("stories", []):
        if s.get("story_id") == story_id:
            timeline = generate_story_timeline(s)
            return JSONResponse(timeline)
    return JSONResponse({"error": "not_found"}, status_code=404)

@app.get("/api/blindspots")
def api_blindspots(min_cov: int = 4):
    """Get stories that show bias blindspots"""
    db = load_db()
    items = compute_blindspots(db.get("stories", []), min_cov=min_cov)
    return JSONResponse({
        "last_updated": db.get("last_updated"),
        "items": items
    })

@app.get("/api/trending")
def api_trending():
    """Get trending topics based on keyword analysis"""
    db = load_db()
    return JSONResponse({
        "last_updated": db.get("last_updated"),
        "topics": db.get("trending_topics", [])
    })

@app.get("/api/sources")
def api_sources():
    """Get all news sources with bias information"""
    return JSONResponse(load_sources())

@app.post("/api/rebuild")
def api_rebuild():
    """Rebuild stories from existing articles"""
    n = rebuild_stories()
    return JSONResponse({"ok": True, "stories": n, "updated_at": now_iso()})