#!/usr/bin/env python3
"""Две новые команды в верхнюю сетку double elimination (вариант Б), остальные матчи и результаты не трогаются.
Запуск: python3 add_pair_upper.py tournament.db saturday228 thesvet1 --qf U2-2 [--when "2026-10-25 18:00"] [--when2 "..."] --apply
  --qf   четвертьфинал, обе команды которого прошли без игры: они сыграют 1/8 между собой (U1-4),
         а новая пара — U1-3; победители обоих матчей возвращаются в этот четвертьфинал.
  --when  время (МСК) матча новой пары, --when2 — матча пары из четвертьфинала; без них — «ожидает».
Без --apply только показывает план."""
import sqlite3, sys, json
from datetime import datetime, timedelta, timezone

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = {k: v for k, v in zip(sys.argv[1:], sys.argv[2:] + [""]) if k.startswith("--")}
if len(args) < 3:
    sys.exit(__doc__)
db, cap1, cap2 = args[0], args[1].lstrip("@").lower(), args[2].lstrip("@").lower()
apply, qf_key = "--apply" in sys.argv, opts.get("--qf") or "U2-2"

MSK = timezone(timedelta(hours=3))
def utc(when):
    if not when:
        return None
    return datetime.strptime(when, "%Y-%m-%d %H:%M").replace(tzinfo=MSK).astimezone(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")
now = datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")
when1, when2 = utc(opts.get("--when")), utc(opts.get("--when2"))

c = sqlite3.connect(db)
c.row_factory = sqlite3.Row
row = lambda sql, *a: c.execute(sql, a).fetchone()
team = lambda cap: row("select t.id, t.name, u.username from teams t join users u on u.id = t.captain_user_id where lower(u.username) = ?", cap)
t1, t2 = team(cap1), team(cap2)
if not t1 or not t2:
    sys.exit(f"Команда не найдена: {cap1 if not t1 else cap2}")
stage = row("select id, tournament_id, format, status, locked from tournament_stages order by order_no limit 1")
if not stage or stage["format"] != "double_elim":
    sys.exit("Нужна стадия double elimination")
names = {r["id"]: r["name"] for r in c.execute("select id, name from teams")}
m = lambda key: row("select * from tournament_matches where stage_id = ? and plan_key = ?", stage["id"], key)
qf = m(qf_key)
if not qf or qf["bracket"] != "upper" or qf["round_no"] != 2:
    sys.exit(f"{qf_key} — не четвертьфинал верхней сетки")
if m(f"U1-{2 * int(qf['position']) - 1}"):
    sys.exit(f"Уже применено: матч U1-{2 * int(qf['position']) - 1} существует")
if qf["status"] != "WAITING" or not qf["team1_id"] or not qf["team2_id"]:
    sys.exit(f"{qf_key} должен ждать с двумя командами, прошедшими без игры (сейчас {qf['status']})")
fed = row("select count(*) n from tournament_matches where winner_to_match_id = ?", qf["id"])["n"]
if fed:
    sys.exit(f"В {qf_key} уже ведут {fed} матч(а) — он не из команд без игры")
# Если между ними уже есть дополнительный матч вне сетки (bracket extra), он станет матчем 1/8 — время сохраняется
extra = row("select * from tournament_matches where stage_id = ? and bracket = 'extra' and status != 'FINISHED' and winner_to_match_id is null "
            "and ((team1_id = ? and team2_id = ?) or (team1_id = ? and team2_id = ?))", stage["id"], t1["id"], t2["id"], t2["id"], t1["id"])
if any(r["team1_id"] in (t1["id"], t2["id"]) or r["team2_id"] in (t1["id"], t2["id"])
       for r in c.execute("select id, team1_id, team2_id from tournament_matches where stage_id = ?", (stage["id"],)) if not extra or r["id"] != extra["id"]):
    sys.exit("Одна из команд уже стоит в сетке")
# Позиции 1/8 для этого четвертьфинала: позиция p четвертьфинала собирает победителей 1/8 с позиций 2p-1 и 2p
p = int(qf["position"])
k1, k2 = f"U1-{2 * p - 1}", f"U1-{2 * p}"
if m(k1) or m(k2):
    sys.exit(f"Матчи {k1}/{k2} уже есть")
# Нижняя сетка: проигравшие двух новых 1/8 — в L1-p; его победитель играет с проигравшим четвертьфинала,
# который сейчас идёт в L3 напрямую (в полной сетке это L2-p), и уже победитель L2-p занимает то место в L3
l1_key, l2_key = f"L1-{p}", f"L2-{p}"
if m(l1_key) or m(l2_key):
    sys.exit(f"Матчи {l1_key}/{l2_key} уже есть")
# Четвертьфинал, чей проигравший сейчас минует L2: в схеме бота L2-p принимает проигравшего U2-(5-p)
donor = m(f"U2-{5 - p}")
if not donor or not donor["loser_to_match_id"]:
    sys.exit(f"Не нашёл U2-{5 - p} с переходом проигравшего")
l3 = row("select * from tournament_matches where id = ?", donor["loser_to_match_id"])
if l3["bracket"] != "lower" or l3["round_no"] != 3:
    sys.exit(f"Проигравший U2-{5 - p} идёт не в L3, а в {l3['plan_key']} — схема другая, стоп")
top = row("select max(match_no) n from tournament_matches where stage_id = ?", stage["id"])["n"]

plan = [
    f"{k1}: {t1['name']} — {t2['name']} (BO{qf['best_of']}), победитель → {qf_key} слот 1, проигравший → {l1_key}"
    + (f" — из дополнительного матча {extra['plan_key']} (id {extra['id']}, время и статус сохраняются)" if extra else ""),
    f"{k2}: {names[qf['team1_id']]} — {names[qf['team2_id']]} (BO{qf['best_of']}), победитель → {qf_key} слот 2, проигравший → {l1_key}",
    f"{qf_key}: команды очищены, ждёт победителей {k1} и {k2}",
    f"{l1_key}: проигравшие {k1} и {k2}, победитель → {l2_key}",
    f"{l2_key}: победитель {l1_key} — проигравший U2-{5 - p} (раньше шёл сразу в {l3['plan_key']}), победитель → {l3['plan_key']} слот {donor['loser_to_slot']}",
]
print(f"Турнир {stage['tournament_id']}, стадия {stage['id']} ({stage['format']}, {stage['status']}, locked={stage['locked']})")
for s in plan:
    print("  " + s)
for t in (t1, t2):
    app = row("select status from tournament_applications where tournament_id = ? and team_id = ?", stage["tournament_id"], t["id"])
    print(f"  {t['name']}: заявка {app['status'] if app else 'нет'} → APPROVED, участник стадии → да")
if not apply:
    sys.exit("Проверка. Чтобы применить, добавьте --apply")

def log(mid, action, old, new):
    c.execute("insert into tournament_match_log (match_id, stage_id, action, old_json, new_json, admin_user_id, created_at) values (?,?,?,?,?,?,?)",
              (mid, stage["id"], action, json.dumps(old, ensure_ascii=False) if old else None, json.dumps(new, ensure_ascii=False), None, now))
def snap(r):
    return {"team1": r["team1_id"], "team2": r["team2_id"], "score1": r["score1"], "score2": r["score2"], "winner": r["winner_team_id"],
            "result_type": r["result_type"], "status": r["status"], "best_of": r["best_of"], "scheduled_at": r["scheduled_at"]}
def insert(key, bracket, rnd, pos, no, rname, a, b, bo, sched, wto, wslot, lto, lslot):
    status = "SCHEDULED" if (a and b and sched) else "WAITING"
    cur = c.execute(
        "insert into tournament_matches (tournament_id, stage_id, plan_key, bracket, round_no, position, match_no, round_name, team1_id, team2_id, "
        "best_of, status, scheduled_at, winner_to_match_id, winner_to_slot, loser_to_match_id, loser_to_slot, version, created_at, updated_at) "
        "values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (stage["tournament_id"], stage["id"], key, bracket, rnd, pos, no, rname, a, b, bo, status, sched, wto, wslot, lto, lslot, 1, now, now))
    r = row("select * from tournament_matches where id = ?", cur.lastrowid)
    log(r["id"], "add_match", None, snap(r))
    return r

with c:
    bo = qf["best_of"]
    l1 = insert(l1_key, "lower", 1, p, top + 3, "Раунд 1", None, None, bo, None, None, None, None, None)
    l2 = insert(l2_key, "lower", 2, p, top + 4, "Раунд 2", None, None, bo, None, l3["id"], donor["loser_to_slot"], None, None)
    c.execute("update tournament_matches set winner_to_match_id = ?, winner_to_slot = 1 where id = ?", (l2["id"], l1["id"]))
    if extra:
        sched = when1 or extra["scheduled_at"]
        c.execute("update tournament_matches set plan_key = ?, bracket = 'upper', round_no = 1, position = ?, round_name = '1/8 финала', "
                  "winner_to_match_id = ?, winner_to_slot = 1, loser_to_match_id = ?, loser_to_slot = 1, scheduled_at = ?, status = ?, "
                  "version = version + 1, updated_at = ? where id = ?",
                  (k1, 2 * p - 1, qf["id"], l1["id"], sched, "SCHEDULED" if sched else "WAITING", now, extra["id"]))
        u3 = row("select * from tournament_matches where id = ?", extra["id"])
        log(u3["id"], "links", {"plan_key": extra["plan_key"], "bracket": extra["bracket"]}, {"plan_key": k1, "bracket": "upper", "winner_to_match_id": qf["id"], "loser_to_match_id": l1["id"]})
    else:
        u3 = insert(k1, "upper", 1, 2 * p - 1, top + 1, "1/8 финала", t1["id"], t2["id"], bo, when1, qf["id"], 1, l1["id"], 1)
    u4 = insert(k2, "upper", 1, 2 * p, top + 2, "1/8 финала", qf["team1_id"], qf["team2_id"], bo, when2, qf["id"], 2, l1["id"], 2)
    old_qf = snap(qf)
    c.execute("update tournament_matches set team1_id = NULL, team2_id = NULL, status = 'WAITING', scheduled_at = NULL, version = version + 1, updated_at = ? where id = ?", (now, qf["id"]))
    log(qf["id"], "teams", old_qf, snap(row("select * from tournament_matches where id = ?", qf["id"])))
    old_donor = {"loser_to_match_id": donor["loser_to_match_id"], "loser_to_slot": donor["loser_to_slot"]}
    c.execute("update tournament_matches set loser_to_match_id = ?, loser_to_slot = 2, version = version + 1, updated_at = ? where id = ?", (l2["id"], now, donor["id"]))
    log(donor["id"], "links", old_donor, {"loser_to_match_id": l2["id"], "loser_to_slot": 2})
    free_seeds = iter(sorted(set(range(1, 17)) - {r["seed"] for r in c.execute("select seed from stage_participants where stage_id = ?", (stage["id"],)) if r["seed"]}))
    for t in (t1, t2):
        if not row("select 1 from stage_participants where stage_id = ? and team_id = ?", stage["id"], t["id"]):
            c.execute("insert into stage_participants (stage_id, team_id, seed, group_label, state) values (?,?,?,NULL,'ACTIVE')", (stage["id"], t["id"], next(free_seeds)))
        app = row("select id, status from tournament_applications where tournament_id = ? and team_id = ?", stage["tournament_id"], t["id"])
        if app and app["status"] != "APPROVED":
            c.execute("update tournament_applications set status = 'APPROVED', admin_comment = ?, decided_at = ?, updated_at = ? where id = ?",
                      ("Возвращена организатором в сетку", now, now, app["id"]))
        elif not app:
            c.execute("insert into tournament_applications (tournament_id, team_id, created_by, status, admin_comment, decided_at, created_at, updated_at) values (?,?,?,?,?,?,?,?)",
                      (stage["tournament_id"], t["id"], None, "APPROVED", "Добавлена организатором в сетку", now, now, now))
print(f"Готово: {k1} id {u3['id']}, {k2} id {u4['id']}, {l1_key} id {l1['id']}, {l2_key} id {l2['id']}. Остальные матчи не тронуты.")
