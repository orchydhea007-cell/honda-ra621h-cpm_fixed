# Honda RA621H — CPM + DAG + Kahn's Topological Sort

> **Struktur Data dan Algoritma | Proyek 2025**
> Visualisasi interaktif Critical Path Method (CPM), Directed Acyclic Graph (DAG), dan Kahn's BFS Topological Sort untuk proses perakitan mesin F1 Honda RA621H — dijalankan sepenuhnya di browser via **Pyodide (Python WebAssembly)** dengan analisis statistik menggunakan **pandas**.

---

## 🏎️ Demo

Buka `index.html` langsung di browser (butuh koneksi internet untuk CDN Pyodide & font).

> **Catatan:** Pyodide membutuhkan beberapa detik loading pertama kali (mengunduh runtime Python + pandas ~10MB). Setelah itu semua komputasi berjalan lokal di browser.

---

## 📂 Struktur Folder

```
honda-ra621h-cpm/
├── index.html              # Entry point — 3 tab UI
├── css/
│   └── style.css           # F1 dark theme, semua styling
├── js/
│   └── main.js             # JavaScript controller + Pyodide bridge
├── py/
│   └── cpm_kahn.py         # 🐍 Python: Kahn's + CPM + pandas
├── data/
│   └── components.json     # Dataset 103 komponen Honda RA621H
└── README.md
```

---

## ⚙️ Teknologi

| Komponen | Teknologi |
|---|---|
| Algoritma utama | **Python** (via Pyodide WebAssembly) |
| Statistik | **pandas** (groupby, agg, cut, describe) |
| UI / interaktivity | Vanilla **JavaScript** (ES2020) |
| Visualisasi graf | **SVG** (built-in browser, no library) |
| Styling | **CSS custom properties**, Google Fonts |
| Build tool | — (tidak ada, zero-dependency) |

---

## 🧠 Algoritma yang Diimplementasikan

### 1. Kahn's Topological Sort (BFS)
```
Kompleksitas: O(V + E)
```
- Hitung **in-degree** semua node
- Masukkan root nodes (in-degree = 0) ke queue
- Loop: dequeue → append ke order → kurangi in-degree successor → jika 0, enqueue
- Validasi: `len(order) == len(nodes)` → tidak ada siklus (valid DAG)
- Menghasilkan **waves** (BFS level) untuk paralelisasi

### 2. Critical Path Method (CPM)

**Forward Pass:**
```
ES[v] = max(EF[u]) untuk semua predecessor u
EF[v] = ES[v] + duration[v]
```

**Backward Pass:**
```
LF[v] = min(LS[w]) untuk semua successor w
LS[v] = LF[v] − duration[v]
```

**Total Float:**
```
Float[v] = LS[v] − ES[v]
Critical Path = node dengan Float = 0
```

### 3. Pandas Statistics
- `groupby('subsystem').agg(...)` — statistik per subsystem
- `pd.cut(df['Float'], bins=...)` — distribusi float
- Gantt-style timeline untuk critical path nodes

---

## 📊 Dataset — Honda RA621H

| Metrik | Nilai |
|---|---|
| Total nodes (komponen) | **103** |
| Total edges (dependensi) | **216** |
| Root nodes (in-degree = 0) | **16** |
| Valid DAG (acyclic) | **✓ True** |
| Subsystems | **19** |
| Critical Path nodes | ~28 |

### Subsystem yang Dimodelkan
- ICE – Internal Combustion Engine (V6 1.6L Turbo Hybrid)
- Turbocharger System
- Hybrid – MGU-H & MGU-K
- Energy Store (ES) – Baterai Li-Ion
- Lubrication, Cooling, Fuel System
- Electronics & Control (ECU)
- Chassis & Monocoque (CFRP)
- Suspension Front & Rear
- Aerodynamics Front & Rear
- Gearbox & Drivetrain (8-speed)
- Braking System (carbon-carbon)
- Wheels & Tyres (Pirelli)
- Cockpit & Safety (Halo titanium)
- Final Assembly

---

## 🖥️ Fitur UI

### Tab 1 — CPM & DAG
- **SVG DAG** interaktif: pan (drag), zoom (scroll/tombol), fit-to-view
- Node berwarna per subsystem, border emas = Critical Path
- **Node Drawer**: klik node → detail lengkap (ES, EF, LS, LF, Float, material, dependensi, catatan teknis)
- **CPM List**: semua node terurut topologis dengan bar ES/LS, filter CP saja

### Tab 2 — Statistik Pandas
- **Float Distribution** — histogram bins via `pd.cut()`
- **Rata-rata Float per Subsystem** — horizontal bar chart
- **Critical Path Gantt Timeline** — proporsi visual ES + durasi
- **Tabel Statistik Subsystem** — komponen, total durasi, mean durasi, jumlah kritis

### Tab 3 — Kahn's Algorithm
- **Step-by-step playback**: Play/Pause/Next/Prev/First/Last
- **Wave Grid**: status node real-time (pending/queued/active/done)
- **In-Degree Tracker**: semua 103 node, counter berkurang live
- **Step Log**: riwayat setiap langkah dengan phase badge
- **Order Strip**: output topological sort yang terbentuk
- **Pseudocode overlay** dengan highlight baris aktif
- Keyboard: `←/→` step, `Space` play/pause, `Home/End`

---

## 🚀 Cara Menjalankan

### Opsi 1: Langsung buka file
```bash
# Cukup buka di browser (Chrome/Firefox/Edge)
open index.html
# atau double-click index.html
```

> ⚠️ Beberapa browser memblokir `fetch()` dari `file://`. Jika dataset tidak termuat, gunakan local server (opsi 2).

### Opsi 2: Local HTTP server (direkomendasikan)
```bash
# Python 3
cd honda-ra621h-cpm
python -m http.server 8080
# Buka: http://localhost:8080
```

```bash
# Node.js
npx serve .
```

```bash
# PHP
php -S localhost:8080
```

### Opsi 3: Deploy ke GitHub Pages
```bash
git init
git add .
git commit -m "feat: Honda RA621H CPM + DAG + Kahn's Algorithm"
git branch -M main
git remote add origin https://github.com/USERNAME/honda-ra621h-cpm.git
git push -u origin main
# Aktifkan GitHub Pages: Settings → Pages → Source: main / root
```

---

## 📦 Dependencies

Semua diambil dari CDN — **tidak perlu `npm install`**:

| Library | Versi | Sumber |
|---|---|---|
| Pyodide | 0.27.5 | jsDelivr CDN |
| pandas | latest (via micropip) | Pyodide package |
| Barlow Condensed | — | Google Fonts |
| JetBrains Mono | — | Google Fonts |

---

## 🔬 Penjelasan Konsep CPM

**Critical Path Method (CPM)** adalah teknik manajemen proyek untuk menemukan urutan tugas terpanjang (critical path) yang menentukan durasi minimum proyek.

```
Proyek tidak bisa selesai lebih cepat dari critical path-nya.
Setiap keterlambatan di critical path = keterlambatan seluruh proyek.
```

**Contoh dari dataset:**
```
C001 (V6 Block, 48h) → C002 (Crankshaft, 24h) → C015 (ICE Assembly, 36h)
  → C055 (Mounting, 8h) → C097 (PU Install, 24h) → C103 (Sign-Off, 8h)
```
Semua node di atas memiliki **Float = 0** → mereka tidak boleh terlambat.

---

## 👤 Author

Proyek SDA 2025 — Honda RA621H F1 Assembly Scheduling
Menggunakan data mesin hybrid turbo Formula 1 musim 2021 (WDC: Max Verstappen / Red Bull Racing Honda)

---

## 📄 Lisensi

MIT License — bebas digunakan untuk keperluan pendidikan.
