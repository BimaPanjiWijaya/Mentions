*[Read in English](README.md)*

# Media Mentions Service

Potongan kecil dari pipeline media monitoring: bulk ingest, search, dan stats
di atas dataset yang sengaja dibuat berantakan.

**Live instance:** belum di-deploy — lihat "Menjalankan secara lokal" di bawah.

**Stack:** Node.js 20+ · TypeScript · Express · PostgreSQL · raw SQL via `pg` · Vitest

---

## Menjalankan secara lokal

Butuh Node 20+ dan instance PostgreSQL.

```bash
git clone https://github.com/BimaPanjiWijaya/Mentions.git
cd Mentions/media-monitor
npm install

cp env.example .env
# Edit .env: isi DATABASE_URL supaya menunjuk ke instance Postgres-mu
# (contoh: postgresql://postgres:<password>@localhost:5432/mentions —
# jalankan `createdb mentions` dulu), kosongkan PGSSL untuk database
# lokal, dan atur PORT kalau 3000 sudah dipakai.

npm run migrate    # menjalankan migrations/001_init.sql
npm run dev        # jalan di http://localhost:3000

# Di terminal kedua — memuat data/seed_mentions.json lewat endpoint asli:
npm run seed
```

Lalu buka http://localhost:3000 untuk dashboard read-only sederhana, atau:

```bash
curl "http://localhost:3000/mentions?q=ringgit&limit=5"
curl "http://localhost:3000/mentions/stats?group_by=source"
curl "http://localhost:3000/mentions/stats?group_by=day"
```

Jalankan test dengan `npm test`.

---

## Endpoint

### `POST /internal/mentions/bulk`

Menerima array record biasa, atau `{ "mentions": [...] }`.

Jalan pertama terhadap `data/seed_mentions.json`:

```json
{
  "received": 15,
  "rejected": 0,
  "collapsed_within_batch": 3,
  "inserted": 12,
  "merged_into_existing": 0,
  "observations_recorded": 15,
  "total_mentions": 12
}
```

Jalan kedua, file yang sama:

```json
{
  "received": 15,
  "rejected": 0,
  "collapsed_within_batch": 3,
  "inserted": 0,
  "merged_into_existing": 12,
  "observations_recorded": 0,
  "total_mentions": 12
}
```

`total_mentions` tidak berubah dan `observations_recorded` nol, jadi
idempotency bisa diverifikasi langsung dari response-nya saja.

### `GET /mentions`

| Param | Tipe | Default | Catatan |
|---|---|---|---|
| `q` | string | — | Full-text di title + content yang sudah dibersihkan. Mendukung `"frasa"`, `-pengecualian`, `or` |
| `source` | slug | — | `the-star`, `new-straits-times`, `malaysiakini`, `twitter`, `facebook`, `instagram` |
| `from` / `to` | tanggal ISO | — | Inklusif. Mention dengan tanggal tidak diketahui otomatis tereksklusi kalau salah satu diisi |
| `page` | int ≥ 1 | 1 | |
| `limit` | int 1–100 | 20 | Dibatasi supaya tidak bisa menarik seluruh tabel dalam satu request |
| `sort` | enum | `published_desc` | `published_desc`, `published_asc`, `engagement_desc`, `relevance` |

**Sort order.** Setiap opsi selalu diakhiri `id DESC` sebagai tiebreaker,
dan default-nya:

```sql
ORDER BY published_at DESC NULLS LAST, id DESC
```

Tanpa tiebreaker itu, baris dengan `published_at` sama (atau sama-sama NULL)
bisa muncul di dua halaman sekaligus, atau hilang di antara keduanya.

### `GET /mentions/stats?group_by=source|day`

Menerima filter yang sama dengan `/mentions`, supaya chart dan list di
dashboard tidak pernah bercerita hal yang berbeda.

`group_by=day` mengelompokkan berdasarkan **Asia/Kuala_Lumpur**, bukan UTC —
analis PR di Malaysia yang bertanya "berapa mention hari Selasa" memaksudkan
Selasa waktu lokal. Bisa diatur lewat `REPORTING_TZ`. Mention tanpa tanggal
publikasi masuk ke bucket `"unknown"`, bukan dibuang begitu saja, supaya
jumlah seluruh bucket selalu sama dengan total.

Hasil asli terhadap dataset yang sudah di-seed:

```json
{
  "group_by": "source",
  "total": 12,
  "buckets": [
    { "key": "new-straits-times", "label": "New Straits Times", "count": 3, "total_engagement": 2024 },
    { "key": "the-star", "label": "The Star", "count": 3, "total_engagement": 2344 },
    { "key": "malaysiakini", "label": "Malaysiakini", "count": 2, "total_engagement": 668 },
    { "key": "twitter", "label": "Twitter", "count": 2, "total_engagement": 2950 },
    { "key": "facebook", "label": "Facebook", "count": 1, "total_engagement": 3402 },
    { "key": "instagram", "label": "Instagram", "count": 1, "total_engagement": 9821 }
  ]
}
```

```json
{
  "group_by": "day",
  "timezone": "Asia/Kuala_Lumpur",
  "total": 12,
  "buckets": [
    { "key": "2026-08-10", "count": 1, "total_engagement": 1204 },
    { "key": "2026-08-11", "count": 3, "total_engagement": 2554 },
    { "key": "2026-08-12", "count": 2, "total_engagement": 4309 },
    { "key": "2026-08-13", "count": 2, "total_engagement": 2515 },
    { "key": "2026-08-14", "count": 1, "total_engagement": 512 },
    { "key": "2026-08-15", "count": 3, "total_engagement": 10115 }
  ]
}
```

---

## Schema

Dua tabel. `migrations/001_init.sql` adalah sumber kebenarannya.

### `mentions` — baris kanonik

Satu baris per satu potongan liputan yang berbeda, setelah deduplikasi.

Nilai mentah dan ternormalisasi disimpan berdampingan: `source_raw` /
`source`, `content_raw` / `content_clean`, `published_at_raw` /
`published_at`. Normalisasi itu proses yang bisa kehilangan informasi dan
aturan saya bisa saja salah; menyimpan versi asli berarti kesalahan itu bisa
diperbaiki tanpa perlu scraping ulang.

`published_at` boleh NULL dan tetap NULL kalau tanggalnya tidak diketahui.
Mengisinya dengan waktu ingest akan diam-diam merusak setiap chart
time-series.

`search_vector` adalah kolom generated tersimpan di atas title + content
yang sudah dibersihkan, dengan index GIN.

Tiga partial unique index menegakkan aturan dedup di level database, tidak
bergantung pada kode aplikasi:

```sql
(source, external_id)         WHERE external_id IS NOT NULL
(url_canonical)                WHERE url_canonical IS NOT NULL
(source, content_fingerprint)  WHERE content_fingerprint IS NOT NULL
```

### `mention_observations` — log ingest mentah

Setiap record input yang diterima dicatat di sini, termasuk yang di-merge
ke mention yang sudah ada. Deduplikasi itu proses yang membuang informasi;
tabel ini menyimpannya. Ini memberi tiga hal:

1. **Auditability** — seorang analis bisa bertanya kenapa dua record
   digabung.
2. **Recoverability** — kalau aturan dedup-nya ternyata salah, baris
   kanonik bisa dibangun ulang tanpa perlu scraping ulang.
3. **Bukti idempotency** — `raw_hash` unik, jadi mem-posting file yang sama
   lagi tidak menghasilkan insert baru apa pun.

---

## Deteksi duplikat

### Prinsip dasarnya

Ini produk media monitoring. Yang dijual produk ini adalah *jumlah
liputan*. Satu fakta itu yang mengarahkan seluruh aturannya:

- Dua outlet yang meliput cerita yang sama adalah **dua mention**.
  Keduanya berharga bagi analis PR, dan menggabungkannya merusak angka
  yang justru menjadi alasan produk ini ada.
- Artikel yang sama, di-scrape dua kali, adalah **satu mention**.

Jadi: **agresif di dalam satu source, konservatif lintas source.**

### Aturannya

Tiga lapis, dicek berurutan berdasarkan prioritas:

| Lapis | Kunci | Tingkat kepercayaan |
|---|---|---|
| 1 | `(source, external_id)` | Tinggi — identitas dari pipeline itu sendiri |
| 2 | `url_canonical` | Tinggi — URL adalah alamat tempat artikel itu berada |
| 3 | `(source, content_fingerprint)` | Sedang — heuristik, karena itu dipagari |

**URL kanonik** menghapus skema, prefix `www.`/`m.`/`amp.`, trailing slash,
dan parameter tracking (`utm_*`, `fbclid`, dll), lalu mengurutkan sisanya.
`x.com` dilebur jadi `twitter.com`.

**Content fingerprint** adalah `sha256(source :: title ternormalisasi ::
content ternormalisasi)`, di mana normalisasinya me-lowercase, menghapus
tanda baca dan emoji, serta merapikan whitespace. Sengaja dipagari:

- **Di-scope per source.** Ini yang menjaga dua artikel tourism-arrivals
  (The Star dan NST) tetap jadi dua mention terpisah.
- **Wajib ≥ 80 karakter content yang sudah dibersihkan.** Post media
  sosial yang pendek terlalu mudah bertabrakan, dan menggabungkan dua post
  yang sebenarnya berbeda berarti kehilangan satu mention nyata.
- **Wajib punya title yang tidak kosong.** Source yang mem-publish stub
  boilerplate tidak bisa membuat seluruh feed-nya kolaps jadi satu.

### Pada file seed

15 record menjadi **12 mention**, dibuktikan lewat `tests/dedupe.test.ts`
dan lewat run asli terhadap endpoint (lihat response ingest di atas):

| Record | Hasil | Lapis |
|---|---|---|
| `str-99120` × 2 | satu mention | `external_id` |
| `nst-40021` (URL sama dengan `str-99120`, id beda) | digabung | `url` |
| `mkn-1201` + `mkn-1202` (isi identik, URL beda, outlet sama) | satu mention | `fingerprint` |
| `str-99502` + `nst-40199` (cerita sama, dua outlet) | **tetap terpisah** | — |

### Merge, bukan skip

Duplikat digabung, bukan dibuang — men-skip berarti kehilangan informasi
yang datang belakangan:

- `mkn-1201` tidak punya tanggal; `mkn-1202` memberikan `11/08/2026`.
- `str-99120` terlihat dengan engagement 412, lalu 415, lalu `"1,204"` —
  mention hasil merge-nya berakhir di engagement 1204 (dikonfirmasi lewat
  `GET /mentions?q=ringgit`).

Aturan merge: jangan pernah menimpa nilai yang sudah diketahui dengan
NULL; `engagement` mengambil nilai tertinggi yang pernah terlihat, karena
engagement naik monoton dan tiap scrape adalah snapshot sesaat;
`ingest_count` dan `last_seen_at` selalu diperbarui.

---

## Asumsi

Di bagian yang brief-nya tidak menjelaskan, berikut yang saya pilih dan
catat.

**`"11/08/2026"` adalah 11 Agustus, bukan 8 November.** Dataset ini
berada di rentang 10–15 Agustus 2026; membacanya sebagai bulan-dulu
membuat record ini jadi outlier tunggal di November. Platform-nya
Malaysia, yang memakai format tanggal hari-dulu.

**Timestamp tanpa timezone dianggap UTC, bukan MYT.** `nst-40021`
(`2026-08-10 08:20:00`) adalah scrape ulang dari artikel yang terbit
`2026-08-10T08:15:00Z`. Dibaca sebagai MYT, artikel ini akan lebih dulu
lima jam daripada sumbernya sendiri; dibaca sebagai UTC, hasilnya lima
menit sesudahnya.

**Prefix `external_id` bersifat opaque.** `nst-40021` membawa `source:
"thestar"` dan URL `thestar.com.my` — field dan URL-nya sepakat, hanya
prefix id dari scraper yang tidak sepakat. Saya memperlakukan id sebagai
string sembarang dan mempercayai field source, dengan fallback ke host
URL.

**String kosong dan title null dianggap sama.** Post media sosial
membawa `null`; satu record Facebook membawa `""`. Keduanya menjadi
NULL.

**Engagement adalah counter yang monoton.** Diperlakukan sebagai
snapshot dari nilai yang hanya naik, itulah kenapa merge mengambil nilai
maksimum.

**Filter tanggal mengeksklusi mention tanpa tanggal.** `from`/`to` pada
`published_at` yang NULL tidak bisa dijawab; mengeksklusi lebih jujur
daripada menebak.

---

## Trade-off yang saya sadari dan terima

**Tanpa ORM.** Brief meminta schema yang terlihat. Raw SQL juga cocok
untuk pekerjaan di sini: query-nya sedikit tapi rumit (lookup dedup
tiga lapis, full-text search, agregasi timezone-aware). Konsekuensinya
adalah indexing parameter manual di `buildWhere`, yang mudah salah;
disentralisasi dalam satu fungsi dan dipakai bersama oleh search dan
stats supaya keduanya tetap konsisten.

**Bulk ingest diserialisasi lewat advisory lock berbasis transaksi.**
Dedup itu operasi read-then-write, jadi dua batch yang berjalan
bersamaan bisa sama-sama tidak menemukan match dan sama-sama insert.
Lock ini menghilangkan race tersebut dengan konsekuensi hilangnya
paralelisme. Bisa diterima karena ini endpoint internal terjadwal.
Partial unique index tetap ada sebagai jaring pengaman di level
database.

**Deduplikasi dalam satu batch terjadi di memori sebelum SQL apa pun
dijalankan.** Ini bukan optimasi. Record 1 dan 2 di file seed adalah
duplikat satu sama lain, dan mengirim keduanya ke satu statement `ON
CONFLICT DO UPDATE` akan memicu error *"command cannot affect row a
second time"*. Menjaganya sebagai fungsi murni juga membuat logika
paling berisiko ini bisa di-test tanpa database.

**Pagination pakai `OFFSET`.** Sederhana dan benar untuk ukuran dataset
ini, tapi melambat pada tabel besar dan bisa bergeser saat ada
penulisan bersamaan. Keyset pagination adalah perbaikannya; lihat
bagian di bawah.

**Satu konfigurasi text-search berbahasa Inggris untuk korpus
dwibahasa.** Datanya campuran Inggris dan Melayu. Stemmer Inggris tidak
men-stem kata Melayu dengan benar, meskipun token Melayu yang tidak
di-stem tetap bisa cocok secara exact match. Deteksi bahasa per-record
adalah perbaikan yang tepat, tapi di luar scope saat ini.

**Tabel alias source ada di dalam kode.** Cukup untuk enam outlet,
salah untuk enam ratus. Tabel `sources` dengan kolom alias yang bisa
diedit analis adalah bentuk yang tepat untuk production.

**Migration hanya maju, tidak ada rollback.** Tidak ada script `down`.
Roll-forward memang yang akan saya lakukan di production juga, tapi tim
yang lebih besar akan lebih memilih `node-pg-migrate` atau `dbmate`
daripada runner 40 baris buatan saya sendiri.

**Parsing angka menghapus semua karakter non-digit.** `"1,204"` →
`1204`. Ini tidak bisa membedakan gaya Eropa `"1.204"` dari desimal
sungguhan. Dataset ini memakai pemisah koma, jadi aman untuk kasus ini.

**`env.example` dikirim dengan nilai kosong, bukan contoh default.**
Isinya mendokumentasikan tiga variabel wajib (`DATABASE_URL`, `PGSSL`,
`PORT`) tanpa menaruh kredensial contoh yang bisa langsung disalin di
dalam repo.

---

## Waktu yang dihabiskan

Kira-kira **10 jam dalam 3 sesi**, 18–20 Agustus 2026:

- **Sesi 1** (~1,5 jam, 18 Agu): scaffold project — struktur repo, setup
  TypeScript + Express, versi dependency dipin, seed data di-commit.
- **Sesi 2** (~5 jam, 19–20 Agu): inti sistemnya — migration schema, layer
  normalisasi enam fungsi (tanggal, engagement, HTML, URL, source,
  fingerprinting) ditulis tanpa regex sesuai constraint brief, aturan
  deduplikasi tiga lapis, dan tiga endpoint (bulk ingest, search, stats),
  plus test suite yang meng-cover logika itu.
- **Sesi 3** (~3,5 jam, 20 Agu): dashboard read-only, verifikasi ke instance
  PostgreSQL lokal sungguhan (migration, seed, tiap endpoint dicoba manual),
  merapikan commit history jadi langkah-langkah logis, dan README ini.

Dikerjakan dengan Claude Code di bawah review ketat — brief-nya eksplisit
mengizinkan ini ("Use them. We do. There is no penalty"). Jam di atas adalah
waktu saya sendiri: membaca seed data dan memutuskan aturan dedup, mereview
tiap fungsi yang ditulis Claude, memverifikasi hasil ke database, dan
menulis ulang bagian yang belum saya puas — bukan waktu Claude generate teks.

---

## Dengan satu minggu lagi, saya akan…

1. **Memisahkan kanonikalisasi dari penyimpanan.** Saat ini aturan
   dedup diterapkan pada saat penulisan, jadi mengubah aturannya berarti
   harus ingest ulang. Karena `mention_observations` sudah menyimpan
   setiap record mentah, saya akan membuat baris kanonik menjadi view
   turunan yang bisa dibangun ulang kapan saja. Itu mengubah aturan
   dedup dari keputusan satu arah menjadi parameter yang bisa
   disetel-setel.

2. **Menambahkan deteksi near-duplicate yang fuzzy.** Fingerprint exact
   melewatkan artikel yang berbeda satu kalimat suntingan.
   SimHash atau kemiripan trigram (`pg_trgm`) di atas content yang sudah
   dibersihkan, dengan threshold yang bisa disetel dan antrian review
   untuk pasangan yang meragukan, alih-alih auto-merge.

3. **Pindah ke keyset pagination** di atas `(published_at, id)`, dan
   menambahkan cursor bergaya `Link` di response.

4. **Deteksi bahasa per-record** yang mengarahkan konfigurasi
   text-search yang tepat, supaya konten Melayu bisa di-stem dengan
   benar.

5. **Endpoint audit merge** — `GET /mentions/:id/observations` —
   supaya seorang analis bisa melihat persis record mentah mana yang
   menghasilkan satu mention dan kenapa. Datanya sudah ada; yang belum
   ada cuma route-nya.

6. **Test integrasi terhadap Postgres sungguhan** lewat Testcontainers,
   mencakup klaim idempotency secara end-to-end, bukan hanya di layer
   dedup in-memory.

---

## Pertanyaan yang ingin saya ajukan

Dua ambiguitas yang saya selesaikan dengan memilih, tapi lebih baik
kalau bisa dikonfirmasi:

1. Pada `nst-40021`, field `source` dan prefix `external_id` tidak
   sepakat. Mana yang dianggap otoritatif oleh pipeline kalian?
2. Kalau sebuah artikel di-scrape ulang dan title atau body-nya sudah
   diedit, apakah record-nya ingin ditimpa, atau riwayat versinya
   disimpan? Saya memilih menimpa-kalau-kosong, yang mempertahankan
   versi pertama — model dengan versi akan jadi schema yang berbeda.
