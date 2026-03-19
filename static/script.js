let ecoChart = null;
let breakdownChart = null;
let weeklyChart = null;

/* ---------------- SET TOTAL ---------------- */
function setTotal(value) {
    animateValue("totalCarbon", 0, value, 600);
}

/* ---------------- ANIMATE NUMBER ---------------- */
function animateValue(id, start, end, duration) {

    let obj = document.getElementById(id);
    if (!obj) return;

    end = Number(end) || 0;

    let range = end - start;
    let current = start;
    let increment = range / (duration / 10);

    let timer = setInterval(function () {
        current += increment;

        if ((increment > 0 && current >= end) ||
            (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }

        obj.innerHTML = current.toFixed(2) + " kg";
    }, 10);
}

/* ---------------- STATUS ---------------- */
function updateStatus(total) {

    let status = document.getElementById("impactStatus");
    if (!status) return;

    if (total < 8) {
        status.innerHTML = "<span class='badge bg-success'>Excellent</span>";
    }
    else if (total < 15) {
        status.innerHTML = "<span class='badge bg-warning text-dark'>Moderate</span>";
    }
    else {
        status.innerHTML = "<span class='badge bg-danger'>Critical</span>";
    }
}

/* ---------------- SAVINGS ---------------- */
function updateSavings(total) {

    let savings = Math.max(0, 8 - total);
    let el = document.getElementById("dailySavings");
    if (!el) return;

    el.innerText = savings.toFixed(2) + " kg";
}

/* ---------------- ENTRY COUNT ---------------- */
function updateEntryCount() {

    fetch("/api/entry-count")
    .then(res => res.json())
    .then(data => {
        let el = document.getElementById("entryCount");
        if (!el) return;
        el.innerText = data.count;
    });
}

/* ---------------- PIE CHART ---------------- */
function createBreakdownChart(t, d, e) {

    const ctx = document.getElementById("breakdownChart");
    if (!ctx) return;

    if (breakdownChart) {
        breakdownChart.destroy();
    }

    breakdownChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Transport', 'Diet', 'Energy'],
            datasets: [{
                data: [t, d, e],
                backgroundColor: [
                    '#2e8b57',
                    '#f4a300',
                    '#2aa1d3'
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { display: false }
            }
        }
    });
}
/* ---------------- ADD ENTRY ---------------- */
function addEntry() {

    let transport = document.getElementById("transport").value;
    let distance = document.getElementById("distance").value || 0;
    let meal = document.getElementById("meal").value;
    let electricity = document.getElementById("electricity").value || 0;

    fetch("/api/add-entry", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({transport, distance, meal, electricity})
    })
    .then(res => res.json())
    .then(() => {
        loadDaily();
        loadDashboard();
        loadWeeklyChart();
    });
}

/* ---------------- LOAD DAILY ---------------- */

function loadDaily() {

    fetch("/api/daily-summary")
    .then(res => res.json())
    .then(data => {

        let total = Number(data.total) || 0;

        setTotal(total);
        updateTotalProgress(total);
        updateStatus(total);
        updateEcoTip(total);
        updateSavings(total);
        createBreakdownChart(
            data.transport || 0,
            data.diet || 0,
            data.energy || 0
        );

        updateEntryCount();
        updateGoalProgress(total);
        updateEcoScore(total);

        loadCarbonOffset();   // IMPORTANT
        loadMonthly();        // IMPORTANT
        showSmartTip(data.transport, data.diet, data.energy);
    });
}
/* ---------------- WEEKLY CHART ---------------- */
function loadWeeklyChart() {

    fetch("/api/weekly-trend")
    .then(res => res.json())
    .then(data => {

        const ctx = document.getElementById("weeklyChart");
        if (!ctx) return;

        if (weeklyChart) weeklyChart.destroy();

        weeklyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.dates,
                datasets: [{
                    label: 'Weekly Carbon (kg)',
                    data: data.totals,
                    backgroundColor: "#22c55e"
                }]
            },
            options: {
                responsive: true,
                scales: { y: { beginAtZero: true } }
            }
        });
    });
}

/* ---------------- RESET ---------------- */
function confirmReset() {

    fetch("/api/reset", { method: "POST" })
    .then(() => {
        loadDaily();
        loadWeeklyChart();

        let modal = bootstrap.Modal.getInstance(
            document.getElementById("resetModal")
        );
        if (modal) modal.hide();
    });
}

/* ---------------- GOAL PROGRESS ---------------- */
function updateGoalProgress(total) {

    let bar = document.getElementById("goalBar");
    if (!bar) return;   // prevents crash

    let goal = 8;
    let percent = (total / goal) * 100;
    percent = Math.min(percent, 100);

    bar.style.width = percent + "%";

    bar.classList.remove("bg-success", "bg-warning", "bg-danger");

    if (total <= goal) {
        bar.classList.add("bg-success");
    } else if (total <= 15) {
        bar.classList.add("bg-warning");
    } else {
        bar.classList.add("bg-danger");
    }
}

/* ---------------- YESTERDAY COMPARISON ---------------- */
function updateYesterdayComparison() {

    fetch("/api/yesterday-comparison")
    .then(res => res.json())
    .then(data => {

        let text = document.getElementById("comparisonText");
        if (!text) return;

        let diff = data.difference || 0;

        if (diff > 0) {
            text.innerHTML = "⬆ Increased by " + diff + " kg vs yesterday";
            text.style.color = "#ef4444";
        }
        else if (diff < 0) {
            text.innerHTML = "⬇ Reduced by " + Math.abs(diff) + " kg vs yesterday";
            text.style.color = "#22c55e";
        }
        else {
            text.innerHTML = "No change from yesterday";
            text.style.color = "#aaa";
        }
    });
}

/* ---------------- ECO SCORE (CIRCULAR) ---------------- */
function updateEcoScore(total) {

    let score;

    if (total <= 8) {
        score = 100 - (total * 5);
    } else if (total <= 15) {
        score = 60 - ((total - 8) * 4);
    } else {
        score = 30 - ((total - 15) * 2);
    }

    if (score < 0) score = 0;
    if (score > 100) score = 100;

    document.getElementById("ecoScoreText").innerText =
        Math.round(score) + "%";

    const ctx = document.getElementById("ecoScoreChart");

    if (ecoChart) ecoChart.destroy();

    ecoChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [score, 100 - score],
                backgroundColor: ["#22c55e", "#e5e7eb"],
                borderWidth: 0
            }]
        },
        options: {
            cutout: "75%",
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            }
        }
    });
}
/* ---------------- SIDEBAR ---------------- */
function toggleSidebar() {
    let sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;
    sidebar.classList.toggle("d-none");
}

/** loadCarbonOffset */
function loadCarbonOffset() {
    fetch("/api/carbon-offset")
    .then(res => res.json())
    .then(data => {
        document.getElementById("treesNeeded").innerText =
            data.trees + " trees";
    });
}

/**api monthly */
function loadMonthly() {
    fetch("/api/monthly-summary")
    .then(res => res.json())
    .then(data => {
        document.getElementById("monthTotal").innerText =
            data.total + " kg";

        document.getElementById("monthAvg").innerText =
            data.average + " kg";

        document.getElementById("monthBest").innerText =
            data.best + " kg";
    });
}

/**  showSmartTip*/

function showSmartTip(transport, diet, energy) {

    let tip = "";

    if (transport > diet && transport > energy) {
        tip = "🚲 Try cycling or public transport to reduce emissions.";
    }
    else if (energy > transport && energy > diet) {
        tip = "💡 Reduce electricity usage or switch to LED bulbs.";
    }
    else {
        tip = "🥗 Plant-based meals reduce your carbon footprint.";
    }

    document.getElementById("smartTip").innerText = tip;
}
/**A */


function updateTotalProgress(total) {

    let goal = 8; // daily goal
    let percent = (total / goal) * 100;
    percent = Math.min(percent, 100);

    let bar = document.getElementById("totalProgressBar");
    if (!bar) return;

    bar.style.width = percent + "%";

    // Color change based on level
    if (total <= goal) {
        bar.style.background = "#2e8b57";
    } else if (total <= 15) {
        bar.style.background = "#f4a300";
    } else {
        bar.style.background = "#dc2626";
    }
}

/**Eco Tip Logic */
function updateEcoTip(total) {

    let tipText = document.getElementById("ecoTipText");
    let card = document.getElementById("ecoTipCard");

    if (!tipText) return;

    if (total <= 5) {
        tipText.innerHTML =
            "Excellent work 🌿 Your carbon footprint is very low today. Keep using sustainable transport and energy wisely!";
        card.style.background = "#e8f7ec";
    }
    else if (total <= 10) {
        tipText.innerHTML =
            "Good job 👍 Try reducing short car trips or switching to public transport to improve further.";
        card.style.background = "#fff7e6";
    }
    else if (total <= 15) {
        tipText.innerHTML =
            "Moderate impact ⚠ Consider reducing electricity usage and meat consumption tomorrow.";
        card.style.background = "#fdecec";
    }
    else {
        tipText.innerHTML =
            "High carbon footprint 🚨 Try avoiding car usage, lower AC usage, and choose plant-based meals.";
        card.style.background = "#ffe5e5";
    }
}
/** Dropdown Logic*/
document.getElementById("statusFilter")
.addEventListener("change", function() {

    let value = this.value;

    if (value === "daily") {
        loadDaily();
    }
    else if (value === "monthly") {
        loadMonthly();
    }
    else if (value === "yearly") {
        loadYearly();
    }
});


/**  monthly yearly*/
function loadMonthly() {

    fetch("/api/monthly-summary")
    .then(res => res.json())
    .then(data => {

        document.getElementById("statusBigNumber")
            .innerText = data.total.toFixed(2);

        document.getElementById("statusLabel")
            .innerText = "kg CO₂ this month";

        createBreakdownChart(
            data.transport,
            data.diet,
            data.energy
        );
    });
}


function loadYearly() {

    fetch("/api/yearly-summary")
    .then(res => res.json())
    .then(data => {

        document.getElementById("statusBigNumber")
            .innerText = data.total.toFixed(2);

        document.getElementById("statusLabel")
            .innerText = "kg CO₂ this year";

        createBreakdownChart(
            data.transport,
            data.diet,
            data.energy
        );
    });
}
/*** */
function animateValue(id, end, suffix="") {

    let start = 0;
    let duration = 1000;
    let stepTime = Math.abs(Math.floor(duration / end));
    let obj = document.getElementById(id);

    let timer = setInterval(function () {
        start += 1;
        obj.innerText = start + suffix;
        if (start >= end) {
            clearInterval(timer);
            obj.innerText = end + suffix;
        }
    }, stepTime);
}

function loadInsights() {

    fetch("/api/insights")
    .then(res => res.json())
    .then(data => {

        // Reduction %
        animateValue("reductionScore", Math.abs(data.reduction), "%");

        if (data.reduction >= 0) {
            document.getElementById("reductionScore").classList.add("text-success");
        } else {
            document.getElementById("reductionScore").classList.add("text-danger");
        }

        // Trees
        animateValue("treesSaved", data.trees);

        // Streak
        animateValue("goalStreak", data.streak, " days");
    });
}

/* ---------------- ON LOAD ---------------- */
window.onload = function() {

    if (localStorage.getItem("theme") === "dark") {
        document.body.classList.add("dark-mode");
    }

    loadDaily();
    loadWeeklyChart();
    loadMonthly();
};