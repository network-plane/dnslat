package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	planews "github.com/network-plane/planeweb-go/ws"

	"dnslat/internal/dnslat/model"
	"dnslat/internal/dnslat/probe"
	"dnslat/internal/dnslat/scheduler"
	"dnslat/internal/dnslat/storage"
)

type Server struct {
	store             *storage.Store
	ws                *planews.Manager
	sched             *scheduler.Scheduler
	saveConfig        func()
	getSaveManualRuns func() bool
	setSaveManualRuns func(bool) error
	getDefaultDomain  func() string
	setDefaultDomain  func(string) error
	appVersion        string
}

func NewServer(
	st *storage.Store,
	sched *scheduler.Scheduler,
	saveConfig func(),
	getSaveManualRuns func() bool,
	setSaveManualRuns func(bool) error,
	getDefaultDomain func() string,
	setDefaultDomain func(string) error,
	appVersion string,
) *Server {
	return &Server{
		store:             st,
		ws:                planews.NewManager(),
		sched:             sched,
		saveConfig:        saveConfig,
		getSaveManualRuns: getSaveManualRuns,
		setSaveManualRuns: setSaveManualRuns,
		getDefaultDomain:  getDefaultDomain,
		setDefaultDomain:  setDefaultDomain,
		appVersion:        appVersion,
	}
}

func (s *Server) BroadcastDNSComplete(runID string) {
	s.ws.Broadcast(map[string]interface{}{
		"type":   "dns-test-complete",
		"run_id": runID,
	})
}

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[api] json encode error (status=%d): %v", code, err)
	}
}

func (s *Server) probeAll(ctx context.Context, domain string) ([]model.RunResult, error) {
	list, err := s.store.ListEnabledResolvers()
	if err != nil {
		log.Printf("[api] ListEnabledResolvers: %v", err)
		return nil, err
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("no enabled resolvers: enable at least one in Preferences")
	}
	log.Printf("[api] probe domain=%q resolvers=%d", domain, len(list))
	var results []model.RunResult
	for _, rv := range list {
		lat, rc, ac, ttl, e := probe.Lookup(ctx, rv.Address, domain)
		det := ""
		if e != nil {
			det = e.Error()
			if lat <= 0 {
				lat = 0
			}
		}
		dj, _ := json.Marshal(map[string]interface{}{
			"rcode_str": probe.RcodeString(rc),
			"error":     det,
		})
		results = append(results, model.RunResult{
			ResolverID:  rv.ID,
			LatencyMs:   lat,
			Rcode:       rc,
			AnswerCount: ac,
			TTLMin:      ttl,
			DetailsJSON: string(dj),
		})
	}
	log.Printf("[api] probe done domain=%q rows=%d", domain, len(results))
	return results, nil
}

func (s *Server) RunProbeAndSave(ctx context.Context, domain string) (string, error) {
	results, err := s.probeAll(ctx, domain)
	if err != nil {
		log.Printf("[api] RunProbeAndSave probe: %v", err)
		return "", err
	}
	id, err := s.store.InsertRun(domain, results)
	if err != nil {
		log.Printf("[api] RunProbeAndSave InsertRun: %v", err)
		return "", err
	}
	log.Printf("[api] RunProbeAndSave saved run_id=%s", id)
	return id, nil
}

func (s *Server) Register(mux *http.ServeMux) {
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/resolvers", s.handleResolvers)
	mux.HandleFunc("/api/resolvers/", s.handleResolverByID)
	mux.HandleFunc("/api/run", s.handleRun)
	mux.HandleFunc("/api/summary", s.handleSummary)
	mux.HandleFunc("/api/dashboard-summary", s.handleDashboardSummary)
	mux.HandleFunc("/api/history", s.handleHistory)
	mux.HandleFunc("/api/chart-data", s.handleChartData)
	mux.HandleFunc("/api/chart-combined", s.handleChartCombined)
	mux.HandleFunc("/api/export/current.json", s.handleExportCurrentJSON)
	mux.HandleFunc("/api/export/current.csv", s.handleExportCurrentCSV)
	mux.HandleFunc("/api/export/history.json", s.handleExportHistoryJSON)
	mux.HandleFunc("/api/export/history.csv", s.handleExportHistoryCSV)
	mux.HandleFunc("/api/runs/", s.handleRunByID)
	mux.HandleFunc("/api/schedules", s.handleSchedules)
	mux.HandleFunc("/api/schedules/", s.handleScheduleByID)
	mux.HandleFunc("/api/next-run", s.handleNextRun)
	mux.HandleFunc("/api/preferences", s.handlePreferences)
	mux.HandleFunc("/api/version", s.handleVersion)
	mux.HandleFunc("/ws", s.handleWS)
}

func (s *Server) handleResolvers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.store.ListResolvers()
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, 200, list)
	case http.MethodPost:
		var body struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" || body.Address == "" {
			http.Error(w, "name and address required", 400)
			return
		}
		res, err := s.store.AddResolver(body.Name, body.Address)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, 201, res)
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleResolverByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/resolvers/")
	id = strings.Trim(id, "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodDelete:
		if err := s.store.DeleteResolver(id); err != nil {
			if strings.Contains(err.Error(), "not found") {
				http.NotFound(w, r)
				return
			}
			http.Error(w, err.Error(), 500)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPatch:
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			http.Error(w, "enabled (boolean) required", 400)
			return
		}
		if err := s.store.SetResolverEnabled(id, *body.Enabled); err != nil {
			if strings.Contains(err.Error(), "not found") {
				http.NotFound(w, r)
				return
			}
			http.Error(w, err.Error(), 500)
			return
		}
		list, _ := s.store.ListResolvers()
		for _, rv := range list {
			if rv.ID == id {
				writeJSON(w, 200, rv)
				return
			}
		}
		http.NotFound(w, r)
	default:
		w.Header().Set("Allow", http.MethodDelete+", "+http.MethodPatch)
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	var body struct {
		Domain string `json:"domain"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	domain := strings.TrimSpace(body.Domain)
	if domain == "" {
		domain = s.getDefaultDomain()
	}
	if domain == "" {
		domain = "example.com"
	}
	ctx := r.Context()
	results, err := s.probeAll(ctx, domain)
	if err != nil {
		code := 500
		if strings.Contains(err.Error(), "no enabled resolvers") {
			code = 400
		}
		log.Printf("[api] POST /api/run failed code=%d domain=%q: %v", code, domain, err)
		http.Error(w, err.Error(), code)
		return
	}
	save := s.getSaveManualRuns()
	if save {
		runID, err := s.store.InsertRun(domain, results)
		if err != nil {
			log.Printf("[api] POST /api/run InsertRun: %v", err)
			http.Error(w, err.Error(), 500)
			return
		}
		log.Printf("[api] POST /api/run saved run_id=%s domain=%q", runID, domain)
		s.BroadcastDNSComplete(runID)
		writeJSON(w, 200, map[string]interface{}{"run_id": runID, "results": results, "saved": true})
		return
	}
	writeJSON(w, 200, map[string]interface{}{"run_id": "", "results": results, "saved": false})
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	latest, err := s.store.LatestRun()
	if err != nil {
		log.Printf("[api] GET /api/summary LatestRun: %v", err)
		http.Error(w, err.Error(), 500)
		return
	}
	resolvers, err := s.store.ListResolvers()
	if err != nil {
		log.Printf("[api] GET /api/summary ListResolvers: %v", err)
		http.Error(w, err.Error(), 500)
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"latest":    latest,
		"resolvers": resolvers,
	})
}

func (s *Server) handleDashboardSummary(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	from30 := now.AddDate(0, 0, -30)
	latest, err := s.store.LatestRun()
	if err != nil {
		log.Printf("[api] GET /api/dashboard-summary LatestRun: %v", err)
		http.Error(w, err.Error(), 500)
		return
	}
	count30, _ := s.store.RunCountSince(from30)
	medians30 := s.store.MediansPerRunInRange(from30, now)
	var avgMedian30 float64
	if len(medians30) > 0 {
		var sum float64
		for _, m := range medians30 {
			sum += m
		}
		avgMedian30 = sum / float64(len(medians30))
	}
	out := map[string]interface{}{
		"query_domain":      "",
		"run_count_30d":     count30,
		"fastest_name":      "",
		"fastest_ms":        0.0,
		"slowest_name":      "",
		"slowest_ms":        0.0,
		"median_all_ms":     0.0,
		"avg_median_30d_ms": avgMedian30,
	}
	if latest != nil {
		out["query_domain"] = latest.QueryDomain
		var lats []float64
		type pair struct {
			name string
			ms   float64
		}
		var pairs []pair
		for _, rr := range latest.Results {
			if rr.LatencyMs > 0 {
				lats = append(lats, rr.LatencyMs)
				n := rr.ResolverName
				if n == "" {
					n = rr.ResolverID
				}
				pairs = append(pairs, pair{n, rr.LatencyMs})
			}
		}
		if len(lats) > 0 {
			out["median_all_ms"] = medianFloat(lats)
			sort.Slice(pairs, func(i, j int) bool { return pairs[i].ms < pairs[j].ms })
			out["fastest_name"] = pairs[0].name
			out["fastest_ms"] = pairs[0].ms
			out["slowest_name"] = pairs[len(pairs)-1].name
			out["slowest_ms"] = pairs[len(pairs)-1].ms
		}
	}
	writeJSON(w, 200, out)
}

func medianFloat(xs []float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	cp := append([]float64(nil), xs...)
	sort.Float64s(cp)
	mid := len(cp) / 2
	if len(cp)%2 == 0 {
		return (cp[mid-1] + cp[mid]) / 2
	}
	return cp[mid]
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if limit <= 0 {
			limit = 50
		}
		off, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		sortCol := strings.TrimSpace(r.URL.Query().Get("sort"))
		if sortCol == "" {
			sortCol = "timestamp"
		}
		asc := strings.EqualFold(r.URL.Query().Get("dir"), "asc")
		order := storage.RunListOrder{Column: sortCol, Asc: asc}
		now := time.Now()
		from := now.AddDate(0, 0, -3650)
		runs, total, err := s.store.ListRuns(from, now, limit, off, order)
		if err != nil {
			log.Printf("[api] GET /api/history ListRuns limit=%d offset=%d sort=%q asc=%v: %v", limit, off, sortCol, asc, err)
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, 200, map[string]interface{}{"results": runs, "total": total})
	case http.MethodDelete:
		n, err := s.store.DeleteAllRuns()
		if err != nil {
			log.Printf("[api] DELETE /api/history DeleteAllRuns: %v", err)
			http.Error(w, err.Error(), 500)
			return
		}
		log.Printf("[api] DELETE /api/history removed %d runs", n)
		s.ws.Broadcast(map[string]interface{}{"type": "dns-test-complete", "cleared": true})
		writeJSON(w, 200, map[string]interface{}{"deleted_runs": n})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func rangeFromQuery(q string) (time.Time, time.Time) {
	now := time.Now()
	switch q {
	case "7d":
		return now.AddDate(0, 0, -7), now
	case "30d":
		return now.AddDate(0, 0, -30), now
	default:
		return now.AddDate(0, 0, -1), now
	}
}

type percentileStats struct {
	Min    float64 `json:"min"`
	P10    float64 `json:"p10"`
	Q1     float64 `json:"q1"`
	Median float64 `json:"median"`
	Q3     float64 `json:"q3"`
	P90    float64 `json:"p90"`
	Max    float64 `json:"max"`
}

func calculatePercentiles(values []float64) percentileStats {
	if len(values) == 0 {
		return percentileStats{}
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	pct := func(p float64) float64 {
		idx := float64(len(sorted)-1) * p
		lo := int(idx)
		hi := lo + 1
		if hi >= len(sorted) {
			hi = len(sorted) - 1
		}
		w := idx - float64(lo)
		return sorted[lo]*(1-w) + sorted[hi]*w
	}
	return percentileStats{
		Min:    sorted[0],
		P10:    pct(0.1),
		Q1:     pct(0.25),
		Median: pct(0.5),
		Q3:     pct(0.75),
		P90:    pct(0.9),
		Max:    sorted[len(sorted)-1],
	}
}

func (s *Server) handleChartData(w http.ResponseWriter, r *http.Request) {
	resolverID := r.URL.Query().Get("metric")
	if resolverID == "" {
		http.Error(w, "metric (resolver id) required", 400)
		return
	}
	from, to := rangeFromQuery(r.URL.Query().Get("range"))
	rows := s.store.ChartRowsForResolver(from, to, resolverID)
	vals := s.store.LatenciesForResolver(from, to, resolverID)
	var stats *percentileStats
	minV, maxV := 0.0, 0.0
	if len(vals) > 0 {
		ps := calculatePercentiles(vals)
		stats = &ps
		minV, maxV = ps.Min, ps.Max
	}
	writeJSON(w, 200, map[string]interface{}{
		"data":      rows,
		"stats":     stats,
		"min_value": minV,
		"max_value": maxV,
	})
}

func (s *Server) handleChartCombined(w http.ResponseWriter, r *http.Request) {
	from, to := rangeFromQuery(r.URL.Query().Get("range"))
	rows := s.store.ChartRowsCombined(from, to)
	writeJSON(w, 200, map[string]interface{}{"data": rows})
}

func (s *Server) latestForExport() (*model.Run, error) {
	return s.store.LatestRun()
}

func (s *Server) handleExportCurrentJSON(w http.ResponseWriter, r *http.Request) {
	run, err := s.latestForExport()
	if err != nil || run == nil {
		http.Error(w, "no runs", 404)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=dnslat-current.json")
	_ = json.NewEncoder(w).Encode(run)
}

func (s *Server) handleExportCurrentCSV(w http.ResponseWriter, r *http.Request) {
	run, err := s.latestForExport()
	if err != nil || run == nil {
		http.Error(w, "no runs", 404)
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=dnslat-current.csv")
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"run_id", "timestamp", "query_domain", "resolver", "latency_ms", "rcode", "answers"})
	for _, rr := range run.Results {
		n := rr.ResolverName
		if n == "" {
			n = rr.ResolverID
		}
		_ = cw.Write([]string{
			run.ID, run.Timestamp.Format(time.RFC3339Nano), run.QueryDomain, n,
			fmt.Sprintf("%.4f", rr.LatencyMs), strconv.Itoa(rr.Rcode), strconv.Itoa(rr.AnswerCount),
		})
	}
	cw.Flush()
}

func (s *Server) handleExportHistoryJSON(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	from := now.AddDate(0, 0, -365)
	runs, _, err := s.store.ListRuns(from, now, 100000, 0, storage.RunListOrder{Column: "timestamp", Asc: false})
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", "attachment; filename=dnslat-history.json")
	_ = json.NewEncoder(w).Encode(runs)
}

func (s *Server) handleExportHistoryCSV(w http.ResponseWriter, r *http.Request) {
	resolvers, _ := s.store.ListResolvers()
	now := time.Now()
	from := now.AddDate(0, 0, -365)
	runs, _, err := s.store.ListRuns(from, now, 100000, 0, storage.RunListOrder{Column: "timestamp", Asc: false})
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=dnslat-history.csv")
	cw := csv.NewWriter(w)
	header := []string{"id", "timestamp", "query_domain"}
	for _, rv := range resolvers {
		header = append(header, rv.Name+" (ms)")
	}
	_ = cw.Write(header)
	for _, run := range runs {
		row := []string{run.ID, run.Timestamp.Format(time.RFC3339Nano), run.QueryDomain}
		byID := make(map[string]float64)
		for _, rr := range run.Results {
			byID[rr.ResolverID] = rr.LatencyMs
		}
		for _, rv := range resolvers {
			v := byID[rv.ID]
			row = append(row, fmt.Sprintf("%.4f", v))
		}
		_ = cw.Write(row)
	}
	cw.Flush()
}

func (s *Server) handleRunByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/runs/")
	id = strings.Trim(id, "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodDelete {
		http.Error(w, "method not allowed", 405)
		return
	}
	if err := s.store.DeleteRun(id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.NotFound(w, r)
			return
		}
		http.Error(w, err.Error(), 500)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func generateID() string {
	return uuid.New().String()
}

func (s *Server) handleSchedules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, s.sched.Schedules())
	case http.MethodPost:
		var sc model.Schedule
		if err := json.NewDecoder(r.Body).Decode(&sc); err != nil {
			http.Error(w, "invalid json", 400)
			return
		}
		if sc.Type == "" {
			sc.Type = model.ScheduleInterval
		}
		sc.ID = generateID()
		if sc.Name == "" {
			sc.Name = sc.ID
		}
		cur := append(s.sched.Schedules(), sc)
		s.sched.SetSchedules(cur)
		if s.saveConfig != nil {
			s.saveConfig()
		}
		writeJSON(w, 201, sc)
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleScheduleByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/schedules/")
	id = strings.Trim(id, "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	cur := s.sched.Schedules()
	switch r.Method {
	case http.MethodGet:
		for _, sc := range cur {
			if sc.ID == id {
				writeJSON(w, 200, sc)
				return
			}
		}
		http.NotFound(w, r)
	case http.MethodPut:
		var upd model.Schedule
		if err := json.NewDecoder(r.Body).Decode(&upd); err != nil {
			http.Error(w, "invalid json", 400)
			return
		}
		upd.ID = id
		found := false
		for i := range cur {
			if cur[i].ID == id {
				cur[i] = upd
				found = true
				break
			}
		}
		if !found {
			http.NotFound(w, r)
			return
		}
		s.sched.SetSchedules(cur)
		if s.saveConfig != nil {
			s.saveConfig()
		}
		writeJSON(w, 200, upd)
	case http.MethodDelete:
		var next []model.Schedule
		for _, sc := range cur {
			if sc.ID != id {
				next = append(next, sc)
			}
		}
		if len(next) == len(cur) {
			http.NotFound(w, r)
			return
		}
		s.sched.SetSchedules(next)
		if s.saveConfig != nil {
			s.saveConfig()
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleNextRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	info := s.sched.NextRunInfo()
	if info.NextRun == nil {
		writeJSON(w, 200, map[string]interface{}{"next_run": nil})
		return
	}
	now := time.Now()
	remaining := info.NextRun.Sub(now)
	if remaining < 0 {
		remaining = 0
	}
	iv := info.IntervalDuration
	if iv <= 0 {
		iv = time.Hour
	}
	writeJSON(w, 200, map[string]interface{}{
		"next_run":          info.NextRun.UTC().Format(time.RFC3339Nano),
		"remaining":         int64(remaining.Seconds()),
		"interval_duration": int64(iv.Seconds()),
		"timestamp":         now.Unix(),
		"interval_ns":       iv.Nanoseconds(),
	})
}

func (s *Server) handlePreferences(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, 200, map[string]interface{}{
			"save_manual_runs":      s.getSaveManualRuns(),
			"default_query_domain":  s.getDefaultDomain(),
		})
	case http.MethodPatch, http.MethodPut:
		var body struct {
			SaveManualRuns     *bool   `json:"save_manual_runs"`
			DefaultQueryDomain *string `json:"default_query_domain"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", 400)
			return
		}
		if body.SaveManualRuns != nil {
			if err := s.setSaveManualRuns(*body.SaveManualRuns); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		if body.DefaultQueryDomain != nil {
			d := strings.TrimSpace(*body.DefaultQueryDomain)
			if d == "" {
				d = "example.com"
			}
			if err := s.setDefaultDomain(d); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
		}
		writeJSON(w, 200, map[string]interface{}{
			"save_manual_runs":     s.getSaveManualRuns(),
			"default_query_domain": s.getDefaultDomain(),
		})
	default:
		http.Error(w, "method not allowed", 405)
	}
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]string{"version": s.appVersion})
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	s.ws.Add(conn)
	defer s.ws.Remove(conn)
	_ = s.ws.WriteJSON(conn, map[string]interface{}{"type": "status", "status": "online"})
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			return
		}
	}
}

// RegisterStatic serves JS and other assets from webdist subfolder.
func RegisterStatic(mux *http.ServeMux, static fs.FS) {
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(static))))
}
