package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"dnslat/internal/dnslat/model"
)

type Store struct {
	db *sql.DB
	mu sync.Mutex
}

// RunListOrder configures ListRuns sort. Column: "" or "timestamp" (default newest first), "id", "query_domain", or a resolver ID to sort by that resolver's latency_ms.
type RunListOrder struct {
	Column string
	Asc    bool
}

func resolveDBPath(dbPath, dataDir string) string {
	if dbPath == "" {
		return filepath.Join(dataDir, "dnslat.results")
	}
	if strings.HasSuffix(dbPath, string(filepath.Separator)) || strings.HasSuffix(dbPath, "/") {
		return filepath.Join(dbPath, "dnslat.results")
	}
	if info, err := os.Stat(dbPath); err == nil && info.IsDir() {
		return filepath.Join(dbPath, "dnslat.results")
	}
	return dbPath
}

func New(dbPath, dataDir string) (*Store, error) {
	final := resolveDBPath(dbPath, dataDir)
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", final)
	if err != nil {
		return nil, err
	}
	// SQLite + database/sql: multiple pooled connections cause SQLITE_BUSY under concurrent
	// HTTP handlers and the scheduler writer. Serialize through one connection + WAL + busy wait.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	for _, q := range []string{
		`PRAGMA busy_timeout = 8000`,
		`PRAGMA journal_mode = WAL`,
		`PRAGMA synchronous = NORMAL`,
	} {
		if _, err := db.Exec(q); err != nil {
			db.Close()
			return nil, fmt.Errorf("%s: %w", q, err)
		}
	}
	s := &Store{db: db}
	if err := s.initSchema(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) initSchema() error {
	_, err := s.db.Exec(`
CREATE TABLE IF NOT EXISTS resolvers (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	address TEXT NOT NULL,
	builtin INTEGER NOT NULL DEFAULT 0,
	sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS runs (
	id TEXT PRIMARY KEY,
	timestamp TEXT NOT NULL,
	query_domain TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_results (
	run_id TEXT NOT NULL,
	resolver_id TEXT NOT NULL,
	latency_ms REAL NOT NULL,
	rcode INTEGER NOT NULL,
	answer_count INTEGER NOT NULL,
	ttl_min INTEGER,
	details_json TEXT,
	PRIMARY KEY (run_id, resolver_id)
);
CREATE INDEX IF NOT EXISTS idx_runs_ts ON runs(timestamp);
`)
	if err != nil {
		return err
	}
	if err := s.migrateResolverEnabled(); err != nil {
		return err
	}
	return s.seedBuiltins()
}

func (s *Store) migrateResolverEnabled() error {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('resolvers') WHERE name='enabled'`).Scan(&n)
	if err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	_, err = s.db.Exec(`ALTER TABLE resolvers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`)
	return err
}

func (s *Store) seedBuiltins() error {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM resolvers`).Scan(&n)
	if n > 0 {
		return nil
	}
	builtins := []struct {
		id, name, addr string
		ord            int
	}{
		{"builtin-google", "Google", "8.8.8.8", 1},
		{"builtin-cloudflare", "Cloudflare", "1.1.1.1", 2},
		{"builtin-quad9", "Quad9", "9.9.9.9", 3},
		{"builtin-opendns", "OpenDNS", "208.67.222.222", 4},
	}
	for _, b := range builtins {
		_, err := s.db.Exec(`INSERT OR IGNORE INTO resolvers (id, name, address, builtin, sort_order, enabled) VALUES (?,?,?,?,?,1)`,
			b.id, b.name, b.addr, 1, b.ord)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ListResolvers() ([]model.Resolver, error) {
	rows, err := s.db.Query(`SELECT id, name, address, builtin, sort_order, enabled FROM resolvers ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.Resolver
	for rows.Next() {
		var r model.Resolver
		var bi, en int
		if err := rows.Scan(&r.ID, &r.Name, &r.Address, &bi, &r.SortOrder, &en); err != nil {
			return nil, err
		}
		r.Builtin = bi != 0
		r.Enabled = en != 0
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListEnabledResolvers returns resolvers the user wants probed (enabled only).
func (s *Store) ListEnabledResolvers() ([]model.Resolver, error) {
	all, err := s.ListResolvers()
	if err != nil {
		return nil, err
	}
	var out []model.Resolver
	for _, r := range all {
		if r.Enabled {
			out = append(out, r)
		}
	}
	return out, nil
}

func (s *Store) AddResolver(name, address string) (*model.Resolver, error) {
	id := uuid.New().String()
	s.mu.Lock()
	defer s.mu.Unlock()
	var maxOrd int
	_ = s.db.QueryRow(`SELECT COALESCE(MAX(sort_order),0)+1 FROM resolvers`).Scan(&maxOrd)
	_, err := s.db.Exec(`INSERT INTO resolvers (id, name, address, builtin, sort_order, enabled) VALUES (?,?,?,?,?,1)`,
		id, name, address, 0, maxOrd)
	if err != nil {
		return nil, err
	}
	return &model.Resolver{ID: id, Name: name, Address: address, Builtin: false, SortOrder: maxOrd, Enabled: true}, nil
}

func (s *Store) DeleteResolver(id string) error {
	res, err := s.db.Exec(`DELETE FROM resolvers WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (s *Store) SetResolverEnabled(id string, enabled bool) error {
	en := 0
	if enabled {
		en = 1
	}
	res, err := s.db.Exec(`UPDATE resolvers SET enabled = ? WHERE id = ?`, en, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	return nil
}

func (s *Store) InsertRun(domain string, results []model.RunResult) (string, error) {
	id := uuid.New().String()
	ts := time.Now().UTC().Format(time.RFC3339Nano)
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO runs (id, timestamp, query_domain) VALUES (?,?,?)`, id, ts, domain); err != nil {
		return "", err
	}
	for _, r := range results {
		_, err = tx.Exec(`INSERT INTO run_results (run_id, resolver_id, latency_ms, rcode, answer_count, ttl_min, details_json) VALUES (?,?,?,?,?,?,?)`,
			id, r.ResolverID, r.LatencyMs, r.Rcode, r.AnswerCount, nullInt(r.TTLMin), nullStr(r.DetailsJSON))
		if err != nil {
			return "", err
		}
	}
	return id, tx.Commit()
}

func nullInt(v int) interface{} {
	if v <= 0 {
		return nil
	}
	return v
}

func nullStr(v string) interface{} {
	if v == "" {
		return nil
	}
	return v
}

// attachResultsForRuns loads run_results for the given runs in one query (avoids N+1 and starving sqlite).
func (s *Store) attachResultsForRuns(runs []model.Run) error {
	if len(runs) == 0 {
		return nil
	}
	var b strings.Builder
	args := make([]interface{}, 0, len(runs))
	b.WriteString(`SELECT rr.run_id, rr.resolver_id,
		COALESCE(NULLIF(TRIM(r.name),''), rr.resolver_id),
		rr.latency_ms, rr.rcode, rr.answer_count, rr.ttl_min, rr.details_json
	FROM run_results rr
	LEFT JOIN resolvers r ON r.id = rr.resolver_id
	WHERE rr.run_id IN (`)
	for i := range runs {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString("?")
		args = append(args, runs[i].ID)
	}
	b.WriteString(`) ORDER BY rr.run_id, COALESCE(r.sort_order, 999999), rr.resolver_id`)
	rows, err := s.db.Query(b.String(), args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	idx := make(map[string]int, len(runs))
	for i := range runs {
		idx[runs[i].ID] = i
		runs[i].Results = nil
	}
	for rows.Next() {
		var runID string
		var rr model.RunResult
		var ttl sql.NullInt64
		var det sql.NullString
		if err := rows.Scan(&runID, &rr.ResolverID, &rr.ResolverName, &rr.LatencyMs, &rr.Rcode, &rr.AnswerCount, &ttl, &det); err != nil {
			return err
		}
		if ttl.Valid {
			rr.TTLMin = int(ttl.Int64)
		}
		if det.Valid {
			rr.DetailsJSON = det.String
		}
		i := idx[runID]
		runs[i].Results = append(runs[i].Results, rr)
	}
	return rows.Err()
}

func (s *Store) LatestRun() (*model.Run, error) {
	var id, ts, dom string
	err := s.db.QueryRow(`SELECT id, timestamp, query_domain FROM runs ORDER BY timestamp DESC LIMIT 1`).Scan(&id, &ts, &dom)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	t, _ := time.Parse(time.RFC3339Nano, ts)
	if t.IsZero() {
		t, _ = time.Parse(time.RFC3339, ts)
	}
	runs := []model.Run{{ID: id, Timestamp: t, QueryDomain: dom}}
	if err := s.attachResultsForRuns(runs); err != nil {
		return nil, err
	}
	return &runs[0], nil
}

func (s *Store) runResults(runID string) ([]model.RunResult, error) {
	// LEFT JOIN: history stays visible if a resolver was removed later (name falls back to id).
	rows, err := s.db.Query(`
SELECT rr.resolver_id,
	COALESCE(NULLIF(TRIM(r.name),''), rr.resolver_id) AS resolver_name,
	rr.latency_ms, rr.rcode, rr.answer_count, rr.ttl_min, rr.details_json
FROM run_results rr
LEFT JOIN resolvers r ON r.id = rr.resolver_id
WHERE rr.run_id = ? ORDER BY COALESCE(r.sort_order, 999999), resolver_name`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.RunResult
	for rows.Next() {
		var rr model.RunResult
		var ttl sql.NullInt64
		var det sql.NullString
		if err := rows.Scan(&rr.ResolverID, &rr.ResolverName, &rr.LatencyMs, &rr.Rcode, &rr.AnswerCount, &ttl, &det); err != nil {
			return nil, err
		}
		if ttl.Valid {
			rr.TTLMin = int(ttl.Int64)
		}
		if det.Valid {
			rr.DetailsJSON = det.String
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

func (s *Store) ListRuns(from, to time.Time, limit, offset int, order RunListOrder) ([]model.Run, int, error) {
	fromNano := from.UTC().Format(time.RFC3339Nano)
	toNano := to.UTC().Format(time.RFC3339Nano)

	var total int
	_ = s.db.QueryRow(`SELECT COUNT(*) FROM runs WHERE timestamp >= ? AND timestamp <= ?`, fromNano, toNano).Scan(&total)

	col := strings.TrimSpace(order.Column)
	dir := "DESC"
	if order.Asc {
		dir = "ASC"
	}

	var rows *sql.Rows
	var err error
	switch {
	case col == "" || col == "timestamp":
		rows, err = s.db.Query(
			`SELECT id, timestamp, query_domain FROM runs
WHERE timestamp >= ? AND timestamp <= ?
ORDER BY timestamp `+dir+`, id DESC LIMIT ? OFFSET ?`,
			fromNano, toNano, limit, offset,
		)
	case col == "id":
		rows, err = s.db.Query(
			`SELECT id, timestamp, query_domain FROM runs
WHERE timestamp >= ? AND timestamp <= ?
ORDER BY id `+dir+`, timestamp DESC LIMIT ? OFFSET ?`,
			fromNano, toNano, limit, offset,
		)
	case col == "query_domain":
		rows, err = s.db.Query(
			`SELECT id, timestamp, query_domain FROM runs
WHERE timestamp >= ? AND timestamp <= ?
ORDER BY query_domain `+dir+`, timestamp DESC, id DESC LIMIT ? OFFSET ?`,
			fromNano, toNano, limit, offset,
		)
	default:
		// Sort by latency for resolver col (resolver id); missing measurement sorts last.
		rows, err = s.db.Query(
			`SELECT r.id, r.timestamp, r.query_domain FROM runs r
LEFT JOIN run_results rr ON rr.run_id = r.id AND rr.resolver_id = ?
WHERE r.timestamp >= ? AND r.timestamp <= ?
ORDER BY (rr.latency_ms IS NULL) ASC, rr.latency_ms `+dir+`, r.timestamp DESC, r.id DESC LIMIT ? OFFSET ?`,
			col, fromNano, toNano, limit, offset,
		)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var runs []model.Run
	for rows.Next() {
		var id, ts, dom string
		if err := rows.Scan(&id, &ts, &dom); err != nil {
			return nil, 0, err
		}
		t, _ := time.Parse(time.RFC3339Nano, ts)
		if t.IsZero() {
			t, _ = time.Parse(time.RFC3339, ts)
		}
		runs = append(runs, model.Run{ID: id, Timestamp: t, QueryDomain: dom})
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	if err := s.attachResultsForRuns(runs); err != nil {
		return nil, 0, err
	}
	return runs, total, nil
}

func (s *Store) RunsInRange(from, to time.Time) ([]model.Run, error) {
	rows, err := s.db.Query(`
SELECT id, timestamp, query_domain FROM runs
WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`,
		from.UTC().Format(time.RFC3339Nano), to.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []model.Run
	for rows.Next() {
		var id, ts, dom string
		if err := rows.Scan(&id, &ts, &dom); err != nil {
			return nil, err
		}
		t, _ := time.Parse(time.RFC3339Nano, ts)
		if t.IsZero() {
			t, _ = time.Parse(time.RFC3339, ts)
		}
		runs = append(runs, model.Run{ID: id, Timestamp: t, QueryDomain: dom})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := s.attachResultsForRuns(runs); err != nil {
		return nil, err
	}
	return runs, nil
}

func (s *Store) ChartRowsForResolver(from, to time.Time, resolverID string) []map[string]interface{} {
	rows, err := s.db.Query(`
SELECT r.timestamp, rr.latency_ms FROM runs r
JOIN run_results rr ON rr.run_id = r.id
WHERE r.timestamp >= ? AND r.timestamp <= ? AND rr.resolver_id = ?
ORDER BY r.timestamp ASC`,
		from.UTC().Format(time.RFC3339Nano), to.UTC().Format(time.RFC3339Nano), resolverID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var ts string
		var lat float64
		if err := rows.Scan(&ts, &lat); err != nil {
			return nil
		}
		t, _ := time.Parse(time.RFC3339Nano, ts)
		if t.IsZero() {
			t, _ = time.Parse(time.RFC3339, ts)
		}
		out = append(out, map[string]interface{}{
			"timestamp": t.UTC().Format(time.RFC3339Nano),
			"values":    map[string]float64{"latency": lat},
		})
	}
	return out
}

func (s *Store) ChartRowsCombined(from, to time.Time) []map[string]interface{} {
	resolvers, _ := s.ListEnabledResolvers()
	rows, err := s.db.Query(`
SELECT r.id, r.timestamp, rr.resolver_id, rr.latency_ms
FROM runs r
JOIN run_results rr ON rr.run_id = r.id
WHERE r.timestamp >= ? AND r.timestamp <= ?
ORDER BY r.timestamp ASC, r.id`,
		from.UTC().Format(time.RFC3339Nano), to.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]interface{}
	var curID string
	var curT time.Time
	vals := make(map[string]float64)
	flush := func() {
		if curID == "" {
			return
		}
		for _, rv := range resolvers {
			if _, ok := vals[rv.ID]; !ok {
				vals[rv.ID] = 0
			}
		}
		cp := make(map[string]float64, len(vals))
		for k, v := range vals {
			cp[k] = v
		}
		out = append(out, map[string]interface{}{
			"timestamp": curT.UTC().Format(time.RFC3339Nano),
			"values":    cp,
		})
		curID = ""
		vals = make(map[string]float64)
	}
	for rows.Next() {
		var id, ts, resID string
		var lat float64
		if err := rows.Scan(&id, &ts, &resID, &lat); err != nil {
			return nil
		}
		if id != curID {
			flush()
			curID = id
			curT, _ = time.Parse(time.RFC3339Nano, ts)
			if curT.IsZero() {
				curT, _ = time.Parse(time.RFC3339, ts)
			}
		}
		vals[resID] = lat
	}
	flush()
	return out
}

func (s *Store) SummaryJSON() ([]byte, error) {
	latest, err := s.LatestRun()
	if err != nil {
		return nil, err
	}
	resolvers, _ := s.ListResolvers()
	m := map[string]interface{}{
		"latest":    latest,
		"resolvers": resolvers,
	}
	return json.Marshal(m)
}

func (s *Store) DeleteRun(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM runs WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("not found")
	}
	_, _ = tx.Exec(`DELETE FROM run_results WHERE run_id = ?`, id)
	return tx.Commit()
}

// DeleteAllRuns removes every run and result row. Resolvers and settings are unchanged.
func (s *Store) DeleteAllRuns() (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var n int64
	if err := tx.QueryRow(`SELECT COUNT(*) FROM runs`).Scan(&n); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM run_results`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM runs`); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}

func (s *Store) RunCountSince(from time.Time) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM runs WHERE timestamp >= ?`, from.UTC().Format(time.RFC3339Nano)).Scan(&n)
	return n, err
}

// LatenciesForResolver returns latency_ms per run in range (chronological).
func (s *Store) LatenciesForResolver(from, to time.Time, resolverID string) []float64 {
	rows, err := s.db.Query(`
SELECT rr.latency_ms FROM runs r
JOIN run_results rr ON rr.run_id = r.id
WHERE r.timestamp >= ? AND r.timestamp <= ? AND rr.resolver_id = ? AND rr.latency_ms > 0
ORDER BY r.timestamp ASC`,
		from.UTC().Format(time.RFC3339Nano), to.UTC().Format(time.RFC3339Nano), resolverID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []float64
	for rows.Next() {
		var lat float64
		if err := rows.Scan(&lat); err != nil {
			return nil
		}
		out = append(out, lat)
	}
	return out
}

func medianFloat(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	cp := append([]float64(nil), xs...)
	for i := 0; i < len(cp); i++ {
		for j := i + 1; j < len(cp); j++ {
			if cp[j] < cp[i] {
				cp[i], cp[j] = cp[j], cp[i]
			}
		}
	}
	mid := len(cp) / 2
	if len(cp)%2 == 0 {
		return (cp[mid-1] + cp[mid]) / 2
	}
	return cp[mid]
}

// MediansPerRunInRange returns median latency across resolvers per run (only resolvers with latency>0).
func (s *Store) MediansPerRunInRange(from, to time.Time) []float64 {
	rows, err := s.db.Query(`
SELECT r.id, rr.latency_ms
FROM runs r
JOIN run_results rr ON rr.run_id = r.id
WHERE r.timestamp >= ? AND r.timestamp <= ? AND rr.latency_ms > 0
ORDER BY r.timestamp ASC, r.id`,
		from.UTC().Format(time.RFC3339Nano), to.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil
	}
	defer rows.Close()
	var medians []float64
	var lastID string
	var bucket []float64
	flush := func() {
		if lastID == "" || len(bucket) == 0 {
			return
		}
		medians = append(medians, medianFloat(bucket))
	}
	for rows.Next() {
		var id string
		var lat float64
		if err := rows.Scan(&id, &lat); err != nil {
			return nil
		}
		if lastID != "" && id != lastID {
			flush()
			bucket = nil
		}
		lastID = id
		bucket = append(bucket, lat)
	}
	flush()
	return medians
}
