from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = "secret"

DATABASE = "database.db"

# ---------------- DB ----------------

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            password TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            date TEXT,
            transport REAL,
            diet REAL,
            energy REAL,
            total REAL
        )
    """)
    conn.commit()
    conn.close()

# ---------------- LOGIN ----------------

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"

class User(UserMixin):
    def __init__(self, id):
        self.id = id

@login_manager.user_loader
def load_user(user_id):
    return User(user_id)

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        conn = get_db()
        conn.execute(
            "INSERT INTO users (email, password) VALUES (?, ?)",
            (request.form["email"],
             generate_password_hash(request.form["password"]))
        )
        conn.commit()
        conn.close()
        return redirect("/login")
    return render_template("register.html")

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        conn = get_db()
        user = conn.execute(
            "SELECT * FROM users WHERE email=?",
            (request.form["email"],)
        ).fetchone()
        conn.close()

        if user and check_password_hash(user["password"], request.form["password"]):
            login_user(User(user["id"]))
            return redirect("/")
    return render_template("login.html")

@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect("/login")

@app.route("/")
@login_required
def dashboard():
    return render_template("index.html")

# ---------------- CARBON LOGIC ----------------

def calculate(transport, distance, meal, electricity):

    if transport == "car":
        t = float(distance) * 0.21
    elif transport == "bus":
        t = float(distance) * 0.10
    else:
        t = float(distance) * 0.05

    d = 1.5 if meal == "veg" else 3
    e = float(electricity) * 0.8

    total = t + d + e
    return t, d, e, total

# ---------------- ADD ENTRY ----------------
@app.route("/api/add-entry", methods=["POST"])
@login_required
def add_entry():

    data = request.get_json()

    t, d, e, total = calculate(
        data["transport"],
        data["distance"],
        data["meal"],
        data["electricity"]
    )

    today = datetime.now().strftime("%Y-%m-%d")

    conn = get_db()

    # Check if today's entry already exists
    existing = conn.execute("""
        SELECT id FROM entries
        WHERE user_id=? AND date=?
    """, (current_user.id, today)).fetchone()

    if existing:
        # UPDATE instead of INSERT
        conn.execute("""
            UPDATE entries
            SET transport=?, diet=?, energy=?, total=?
            WHERE user_id=? AND date=?
        """, (t, d, e, total, current_user.id, today))
    else:
        # INSERT new entry
        conn.execute("""
            INSERT INTO entries (user_id, date, transport, diet, energy, total)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (current_user.id, today, t, d, e, total))

    conn.commit()
    conn.close()

    return jsonify({"success": True})


# ---------------- SUMMARY APIs ----------------
@app.route("/api/daily-summary")
@login_required
def daily_summary():

    conn = get_db()
    data = conn.execute("""
        SELECT 
            SUM(transport) as transport,
            SUM(diet) as diet,
            SUM(energy) as energy,
            SUM(total) as total
        FROM entries
        WHERE user_id=? AND DATE(date)=DATE('now')
    """, (current_user.id,)).fetchone()
    conn.close()

    transport = data["transport"] or 0
    diet = data["diet"] or 0
    energy = data["energy"] or 0
    total = data["total"] or 0

    status = "Excellent" if total < 8 else "Moderate" if total < 15 else "Critical"
    savings = max(0, 8 - total)

    return jsonify({
    "transport": round(transport, 2),
    "diet": round(diet, 2),
    "energy": round(energy, 2),
    "total": round(total, 2),
    "status": status,
    "savings": round(savings, 2)
})


# ---------------- WEEKLY CHART ----------------

@app.route("/api/weekly-trend")
@login_required
def weekly_trend():

    conn = get_db()
    rows = conn.execute("""
        SELECT date, SUM(total) as total
        FROM entries
        WHERE user_id=? AND DATE(date)>=DATE('now','-6 days')
        GROUP BY date
    """, (current_user.id,)).fetchall()
    conn.close()

    dates = []
    totals = []

    for i in range(7):
        day = datetime.now() - timedelta(days=6-i)
        formatted = day.strftime("%Y-%m-%d")
        dates.append(formatted)
        totals.append(0)

    for r in rows:
        if r["date"] in dates:
            index = dates.index(r["date"])
            totals[index] = r["total"]

    return jsonify({"dates": dates, "totals": totals})

# ---------------- RESET ----------------

@app.route("/api/reset", methods=["POST"])
@login_required
def reset():
    conn = get_db()
    conn.execute("DELETE FROM entries WHERE user_id=?", (current_user.id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


##### Entry count

@app.route("/api/entry-count")
@login_required
def entry_count():

    conn = get_db()
    data = conn.execute("""
        SELECT COUNT(*) as count
        FROM entries
        WHERE user_id=?
    """, (current_user.id,)).fetchone()
    conn.close()

    return jsonify({"count": data["count"]})


#### yesterday comaprision 
@app.route("/api/yesterday-comparison")
@login_required
def yesterday_comparison():

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    conn = get_db()

    today_total = conn.execute("""
        SELECT SUM(total) as total
        FROM entries
        WHERE user_id = ?
        AND date = ?
    """, (current_user.id, today)).fetchone()

    yesterday_total = conn.execute("""
        SELECT SUM(total) as total
        FROM entries
        WHERE user_id = ?
        AND date = ?
    """, (current_user.id, yesterday)).fetchone()

    conn.close()

    t = today_total["total"] or 0
    y = yesterday_total["total"] or 0

    difference = t - y

    return jsonify({
        "difference": round(difference, 2)
    })





###### api carbon offset ####

@app.route("/api/carbon-offset")
@login_required
def carbon_offset():

    conn = get_db()
    data = conn.execute("""
        SELECT SUM(total) as total
        FROM entries
        WHERE user_id=? AND DATE(date)=DATE('now')
    """, (current_user.id,)).fetchone()
    conn.close()

    total = data["total"] or 0

    trees_needed = round(total / 21, 2)

    return jsonify({"trees": trees_needed})


###-------Monthly + Yearly----------
@app.route("/api/monthly-summary")
@login_required
def monthly_summary():

    conn = get_db()
    data = conn.execute("""
        SELECT 
            SUM(transport) as transport,
            SUM(diet) as diet,
            SUM(energy) as energy,
            SUM(total) as total
        FROM entries
        WHERE user_id=?
        AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')
    """, (current_user.id,)).fetchone()
    conn.close()

    return jsonify({
        "transport": data["transport"] or 0,
        "diet": data["diet"] or 0,
        "energy": data["energy"] or 0,
        "total": data["total"] or 0
    })


@app.route("/api/yearly-summary")
@login_required
def yearly_summary():

    conn = get_db()
    data = conn.execute("""
        SELECT 
            SUM(transport) as transport,
            SUM(diet) as diet,
            SUM(energy) as energy,
            SUM(total) as total
        FROM entries
        WHERE user_id=?
        AND strftime('%Y', date) = strftime('%Y', 'now')
    """, (current_user.id,)).fetchone()
    conn.close()

    return jsonify({
        "transport": data["transport"] or 0,
        "diet": data["diet"] or 0,
        "energy": data["energy"] or 0,
        "total": data["total"] or 0
    })

#---------------------------#

@app.route("/api/insights")
@login_required
def insights():

    conn = get_db()

    # Current week total
    current_week = conn.execute("""
        SELECT SUM(total) as total
        FROM entries
        WHERE user_id=? 
        AND DATE(date) >= DATE('now','-6 days')
    """, (current_user.id,)).fetchone()["total"] or 0

    # Previous week total
    previous_week = conn.execute("""
        SELECT SUM(total) as total
        FROM entries
        WHERE user_id=? 
        AND DATE(date) BETWEEN DATE('now','-13 days') 
        AND DATE('now','-7 days')
    """, (current_user.id,)).fetchone()["total"] or 0

    # Real streak (days below 8kg)
    streak_rows = conn.execute("""
        SELECT date, SUM(total) as total
        FROM entries
        WHERE user_id=?
        GROUP BY date
        ORDER BY date DESC
    """, (current_user.id,)).fetchall()

    streak = 0
    for row in streak_rows:
        if row["total"] < 8:
            streak += 1
        else:
            break

    conn.close()

    reduction = 0
    if previous_week > 0:
        reduction = round(((previous_week - current_week) / previous_week) * 100, 2)

    trees_saved = round(current_week / 21, 2)

    return jsonify({
        "reduction": reduction,
        "trees": trees_saved,
        "streak": streak
    })
# ---------------- RUN ----------------

if __name__ == "__main__":
    init_db()
    app.run(debug=True)