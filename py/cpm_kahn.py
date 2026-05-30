"""
cpm_kahn.py
Honda RA621H — Kahn's Topological Sort + Critical Path Method (CPM)
Struktur Data dan Algoritma | Proyek 2025

Kompleksitas:
  - Kahn's Algorithm : O(V + E)
  - CPM Forward Pass : O(V + E)
  - CPM Backward Pass: O(V + E)
  - Total Float      : O(V)

Dijalankan di browser via Pyodide (WebAssembly).
"""

import json
from collections import defaultdict


# ═══════════════════════════════════════════════
# GRAPH BUILDER
# ═══════════════════════════════════════════════

def build_graph(components):
    """
    Bangun struktur graph dari list komponen.
    Returns dict: nodes, adj, radj, in_degree
    """
    nodes     = {}
    adj       = defaultdict(set)   # id -> set successors
    radj      = defaultdict(set)   # id -> set predecessors
    in_degree = {}

    for c in components:
        cid = c["id"]
        nodes[cid] = c
        in_degree[cid] = 0

    for c in components:
        cid = c["id"]
        for dep in c.get("deps", []):
            if dep not in nodes:
                continue
            adj[dep].add(cid)
            radj[cid].add(dep)
            in_degree[cid] += 1

    return {"nodes": nodes, "adj": adj, "radj": radj, "in_degree": in_degree}


# ═══════════════════════════════════════════════
# KAHN'S TOPOLOGICAL SORT — BFS
# ═══════════════════════════════════════════════

def run_kahn(graph):
    """
    Kahn's Algorithm dengan step-by-step recording untuk UI replay.
    Returns: steps, order, waves, valid
    """
    nodes     = graph["nodes"]
    adj       = graph["adj"]
    in_degree = graph["in_degree"]
    degree    = dict(in_degree)   # working copy

    steps = []
    order = []
    waves = []

    # ── STEP 0: Init ──
    initial_queue = [cid for cid, d in degree.items() if d == 0]
    steps.append({
        "phase":       "init",
        "description": "Hitung in-degree tiap node. Masukkan semua node dengan in-degree = 0 ke queue awal.",
        "queue":       list(initial_queue),
        "processed":   [],
        "justDone":    [],
        "justQueued":  list(initial_queue),
        "waveIndex":   -1,
        "degree":      dict(degree),
        "order":       [],
    })

    queue    = list(initial_queue)
    wave_idx = 0

    while queue:
        wave      = list(queue)
        new_queue = []
        just_queued = []

        waves.append(wave)

        steps.append({
            "phase":       "wave-start",
            "description": f"Wave {wave_idx + 1}: {len(wave)} node siap diproses (semua predecessor sudah selesai).",
            "queue":       list(wave),
            "processed":   list(order),
            "justDone":    [],
            "justQueued":  [],
            "waveIndex":   wave_idx,
            "degree":      dict(degree),
            "order":       list(order),
            "wave":        wave,
        })

        for cid in wave:
            order.append(cid)
            freed = []

            for succ in adj[cid]:
                degree[succ] -= 1
                if degree[succ] == 0:
                    new_queue.append(succ)
                    freed.append(succ)
                    just_queued.append(succ)

            name      = nodes[cid].get("name", cid)
            freed_str = f" Node baru masuk queue: {', '.join(freed)}." if freed else " Tidak ada successor baru yang siap."
            steps.append({
                "phase":       "process",
                "description": f'Proses {cid} — "{name}". Kurangi in-degree semua successor.{freed_str}',
                "queue":       list(new_queue),
                "processed":   list(order),
                "justDone":    [cid],
                "justQueued":  freed,
                "waveIndex":   wave_idx,
                "degree":      dict(degree),
                "order":       list(order),
                "activeNode":  cid,
                "wave":        wave,
            })

        queue = new_queue
        wave_idx += 1

    valid = len(order) == len(nodes)
    done_desc = (
        f"✓ Topological sort selesai. {len(order)} node diurutkan dalam {len(waves)} wave. Graph valid — tidak ada siklus."
        if valid else
        f"⚠ Siklus terdeteksi! Hanya {len(order)}/{len(nodes)} node yang bisa diurutkan."
    )

    steps.append({
        "phase":       "done",
        "description": done_desc,
        "queue":       [],
        "processed":   list(order),
        "justDone":    [],
        "justQueued":  [],
        "waveIndex":   wave_idx - 1,
        "degree":      dict(degree),
        "order":       list(order),
        "valid":       valid,
    })

    return steps, order, waves, valid


# ═══════════════════════════════════════════════
# CPM — FORWARD PASS
# ═══════════════════════════════════════════════

def cpm_forward_pass(graph, topo_order):
    """
    Forward Pass: hitung ES (Earliest Start) dan EF (Earliest Finish).
      ES[v] = max(EF[u]) untuk semua predecessor u
      EF[v] = ES[v] + duration[v]
    """
    nodes = graph["nodes"]
    radj  = graph["radj"]
    ES    = {}
    EF    = {}

    for node in topo_order:
        duration     = nodes[node].get("duration", 0)
        predecessors = list(radj[node])

        if not predecessors:
            ES[node] = 0
        else:
            ES[node] = max(EF[p] for p in predecessors)

        EF[node] = ES[node] + duration

    return ES, EF


# ═══════════════════════════════════════════════
# CPM — BACKWARD PASS
# ═══════════════════════════════════════════════

def cpm_backward_pass(graph, topo_order, EF, project_duration):
    """
    Backward Pass: hitung LF (Latest Finish) dan LS (Latest Start).
      LF[v] = min(LS[w]) untuk semua successor w
      LS[v] = LF[v] – duration[v]
    """
    nodes = graph["nodes"]
    adj   = graph["adj"]
    LF    = {}
    LS    = {}

    for node in reversed(topo_order):
        duration   = nodes[node].get("duration", 0)
        successors = list(adj[node])

        if not successors:
            LF[node] = project_duration
        else:
            LF[node] = min(LS[s] for s in successors)

        LS[node] = LF[node] - duration

    return LF, LS


# ═══════════════════════════════════════════════
# CPM — TOTAL FLOAT + CRITICAL PATH
# ═══════════════════════════════════════════════

def compute_float(topo_order, ES, LS):
    """
    Total Float = LS - ES
    Node dengan Float = 0 berada di Critical Path.
    """
    float_val      = {}
    critical_nodes = []

    for node in topo_order:
        float_val[node] = LS[node] - ES[node]
        if float_val[node] == 0:
            critical_nodes.append(node)

    return float_val, critical_nodes


# ═══════════════════════════════════════════════
# PANDAS STATISTICS (dijalankan di Pyodide)
# ═══════════════════════════════════════════════

def compute_pandas_stats(components, topo_order, ES, EF, LS, LF, float_val):
    """
    Hitung statistik menggunakan pandas.
    Returns dict berisi berbagai DataFrame sebagai JSON.
    """
    import pandas as pd

    records = []
    for c in components:
        cid = c["id"]
        if cid not in ES:
            continue
        records.append({
            "id":        cid,
            "name":      c.get("name", ""),
            "subsystem": c.get("subsystem", ""),
            "duration":  c.get("duration", 0),
            "critical":  c.get("critical", False),
            "ES":        ES[cid],
            "EF":        EF[cid],
            "LS":        LS[cid],
            "LF":        LF[cid],
            "Float":     float_val[cid],
            "on_cp":     float_val[cid] == 0,
        })

    df = pd.DataFrame(records)

    # ── 1. Statistik deskriptif per subsystem ──
    subsys_stats = df.groupby("subsystem").agg(
        jumlah_komponen=("id", "count"),
        total_durasi=("duration", "sum"),
        mean_durasi=("duration", "mean"),
        max_float=("Float", "max"),
        min_float=("Float", "min"),
        komponen_kritis=("on_cp", "sum"),
    ).reset_index()
    subsys_stats["mean_durasi"] = subsys_stats["mean_durasi"].round(1)
    subsys_stats = subsys_stats.sort_values("total_durasi", ascending=False)

    # ── 2. Distribusi float (histogram bins) ──
    bins      = list(range(0, int(df["Float"].max()) + 51, 50))
    df["bin"] = pd.cut(df["Float"], bins=bins, right=False)
    float_dist = df.groupby("bin", observed=False).size().reset_index(name="count")
    float_dist["bin"] = float_dist["bin"].astype(str)
    # Hapus kolom 'bin' dari df agar tidak masuk ke all_nodes (Interval tidak JSON-serializable)
    df = df.drop(columns=["bin"])

    # ── 3. Critical path detail ──
    cp_df = df[df["on_cp"]].sort_values("ES")[
        ["id", "name", "subsystem", "duration", "ES", "EF", "LS", "LF", "Float"]
    ]

    # ── 4. Project summary ──
    summary = {
        "total_nodes":     len(df),
        "total_edges":     sum(len(c.get("deps", [])) for c in components),
        "project_duration": int(df["EF"].max()),
        "critical_nodes":  int(df["on_cp"].sum()),
        "non_critical":    int((~df["on_cp"]).sum()),
        "avg_float":       round(float(df["Float"].mean()), 1),
        "max_float":       int(df["Float"].max()),
        "subsystems":      int(df["subsystem"].nunique()),
        "root_nodes":      int((df["ES"] == 0).sum()),
    }

    # ── 5. Float per subsystem (untuk bar chart) ──
    float_by_sub = df.groupby("subsystem")["Float"].mean().round(1).reset_index()
    float_by_sub.columns = ["subsystem", "avg_float"]
    float_by_sub = float_by_sub.sort_values("avg_float")

    return {
        "subsys_stats":  subsys_stats.to_dict(orient="records"),
        "float_dist":    float_dist.to_dict(orient="records"),
        "cp_detail":     cp_df.to_dict(orient="records"),
        "summary":       summary,
        "float_by_sub":  float_by_sub.to_dict(orient="records"),
        "all_nodes":     df.to_dict(orient="records"),
    }


# ═══════════════════════════════════════════════
# ENTRY POINT (dipanggil dari JavaScript via Pyodide)
# ═══════════════════════════════════════════════

def run_full_analysis(components_json: str) -> str:
    """
    Main entry point: terima components JSON, jalankan seluruh analisis,
    kembalikan hasil sebagai JSON string.
    """
    components = json.loads(components_json)

    # 1. Build graph
    graph = build_graph(components)

    # 2. Kahn's topological sort
    steps, topo_order, waves, valid = run_kahn(graph)

    if not valid:
        return json.dumps({"error": "Cycle detected — bukan DAG yang valid.", "valid": False})

    # 3. CPM forward + backward pass
    ES, EF = cpm_forward_pass(graph, topo_order)
    project_duration = max(EF.values())
    LF, LS = cpm_backward_pass(graph, topo_order, EF, project_duration)

    # 4. Float + critical path
    float_val, critical_nodes = compute_float(topo_order, ES, LS)

    # 5. Pandas statistics
    pandas_stats = compute_pandas_stats(
        components, topo_order, ES, EF, LS, LF, float_val
    )

    # 6. Statistik graph
    nodes     = graph["nodes"]
    adj       = graph["adj"]
    in_degree = graph["in_degree"]
    roots     = [cid for cid, d in in_degree.items() if d == 0]
    leaves    = [cid for cid in nodes if len(adj[cid]) == 0]
    wave_sizes = [len(w) for w in waves]

    graph_stats = {
        "nodeCount":        len(nodes),
        "edgeCount":        sum(len(s) for s in adj.values()),
        "rootCount":        len(roots),
        "leafCount":        len(leaves),
        "waveCount":        len(waves),
        "maxWaveSize":      max(wave_sizes) if wave_sizes else 0,
        "avgWaveSize":      round(len(nodes) / len(waves), 1) if waves else 0,
        "stepCount":        len(steps),
        "projectDuration":  project_duration,
        "criticalCount":    len(critical_nodes),
    }

    # 7. Build serializable CPM result per node
    cpm_nodes = {}
    for nid in topo_order:
        cpm_nodes[nid] = {
            "ES":    ES[nid],
            "EF":    EF[nid],
            "LS":    LS[nid],
            "LF":    LF[nid],
            "Float": float_val[nid],
            "on_cp": float_val[nid] == 0,
        }

    # 8. Serializable graph
    serializable_graph = {
        "nodes":     graph["nodes"],
        "adj":       {k: list(v) for k, v in graph["adj"].items()},
        "radj":      {k: list(v) for k, v in graph["radj"].items()},
        "in_degree": graph["in_degree"],
    }

    result = {
        "valid":       valid,
        "graph":       serializable_graph,
        "steps":       steps,
        "order":       topo_order,
        "waves":       waves,
        "graphStats":  graph_stats,
        "cpmNodes":    cpm_nodes,
        "pandasStats": pandas_stats,
    }

    return json.dumps(result)
