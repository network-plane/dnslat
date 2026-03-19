package main

import (
	"bufio"
	"context"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	planeweblisten "github.com/network-plane/planeweb-go/listen"
	"github.com/spf13/cobra"

	"dnslat/internal/dnslat/api"
	"dnslat/internal/dnslat/config"
	"dnslat/internal/dnslat/scheduler"
	"dnslat/internal/dnslat/storage"
	"dnslat/internal/dnslat/theme"
)

//go:embed all:webdist
var webdist embed.FS

//go:embed all:templates
var templatesFS embed.FS

var (
	listenAddr string
	listenPort int
	dataDir    string
	dbPath     string
	configPath string
	appVersion = "0.1.0"
)

func main() {
	root := &cobra.Command{
		Use:   "dnslat",
		Short: "DNS latency dashboard",
		Run:   run,
	}
	root.Flags().StringVar(&listenAddr, "listen", "all", "listen address")
	root.Flags().IntVar(&listenPort, "listen-port", 8090, "port")
	root.Flags().StringVar(&dataDir, "data-dir", "", "data directory (dnslat.results + dnslat.config; schedules load/save from here when set)")
	root.Flags().StringVar(&dbPath, "db", "", "database file path")
	root.Flags().StringVar(&configPath, "config", "", "config file path (default: dnslat.config in cwd)")
	if err := root.Execute(); err != nil {
		log.Fatal(err)
	}
}

func run(cmd *cobra.Command, args []string) {
	loadPath := configPath
	if loadPath == "" && dataDir != "" {
		absData, err := filepath.Abs(dataDir)
		if err != nil {
			log.Fatal(err)
		}
		loadPath = filepath.Join(absData, "dnslat.config")
	}
	cfg, err := config.Load(loadPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	if dataDir != "" {
		abs, err := filepath.Abs(dataDir)
		if err != nil {
			log.Fatal(err)
		}
		cfg.DataDir = abs
		// Persist schedules next to DB when using --data-dir (same file we loaded above).
		if configPath == "" {
			absCfg, _ := filepath.Abs(filepath.Join(abs, "dnslat.config"))
			cfg.ConfigFile = absCfg
		}
	} else {
		cfg.DataDir, _ = filepath.Abs(cfg.DataDir)
	}
	_ = os.MkdirAll(cfg.DataDir, 0o755)

	if cfg.LastRun == nil {
		cfg.LastRun = make(map[string]time.Time)
	}

	effectiveDB := dbPath
	if effectiveDB == "" {
		effectiveDB = cfg.DBPath
	}

	st, err := storage.New(effectiveDB, cfg.DataDir)
	if err != nil {
		log.Fatalf("storage: %v", err)
	}

	cfgFile := cfg.ConfigFile
	if cfgFile == "" {
		cfgFile = "(unset; save uses data_dir/dnslat.config)"
	}
	dbFile := effectiveDB
	if dbFile == "" {
		dbFile = filepath.Join(cfg.DataDir, "dnslat.results")
	} else if fi, e := os.Stat(effectiveDB); e == nil && fi.IsDir() {
		dbFile = filepath.Join(effectiveDB, "dnslat.results")
	}

	useCLIListen := cmd.Flags().Changed("listen") || cmd.Flags().Changed("listen-port")
	tcpAddr := config.TCPListenAddress(useCLIListen, listenAddr, listenPort, cfg.ListenAddr)

	log.Printf("[dnslat] startup config_file=%q data_dir=%q db_file=%q listen=%q public_dashboard=%v",
		cfgFile, cfg.DataDir, dbFile, tcpAddr, cfg.PublicDashboard)
	log.Printf("[dnslat] startup schedules=%d save_manual_runs=%v default_domain=%q",
		len(cfg.Schedules), cfg.SaveManualRuns, cfg.DefaultQueryDomain)
	if rlist, e := st.ListResolvers(); e != nil {
		log.Printf("[dnslat] startup ListResolvers: %v", e)
	} else {
		nEn := 0
		for _, x := range rlist {
			if x.Enabled {
				nEn++
			}
		}
		log.Printf("[dnslat] startup resolvers=%d enabled_for_probe=%d", len(rlist), nEn)
	}

	var cfgMu sync.RWMutex
	appCfg := cfg
	var sched *scheduler.Scheduler
	saveCfg := func() {
		cfgMu.Lock()
		if sched != nil {
			appCfg.Schedules = sched.Schedules()
			appCfg.LastRun = sched.LastRun()
		}
		err := config.Save(appCfg)
		cfgMu.Unlock()
		if err != nil {
			log.Printf("save config: %v", err)
		}
	}

	var apiSrv *api.Server
	sched = scheduler.New(
		func(ctx context.Context) error {
			cfgMu.RLock()
			dom := appCfg.DefaultQueryDomain
			cfgMu.RUnlock()
			if dom == "" {
				dom = "example.com"
			}
			_, err := apiSrv.RunProbeAndSave(ctx, dom)
			return err
		},
		appCfg.Schedules,
		appCfg.LastRun,
	)
	sched.SetOnUpdate(saveCfg)
	sched.SetOnComplete(func() {
		latest, _ := st.LatestRun()
		if latest != nil {
			apiSrv.BroadcastDNSComplete(latest.ID)
		}
	})

	apiSrv = api.NewServer(
		st,
		sched,
		saveCfg,
		func() bool { cfgMu.RLock(); defer cfgMu.RUnlock(); return appCfg.SaveManualRuns },
		func(v bool) error {
			cfgMu.Lock()
			appCfg.SaveManualRuns = v
			err := config.Save(appCfg)
			cfgMu.Unlock()
			return err
		},
		func() string { cfgMu.RLock(); defer cfgMu.RUnlock(); return appCfg.DefaultQueryDomain },
		func(d string) error {
			cfgMu.Lock()
			appCfg.DefaultQueryDomain = d
			err := config.Save(appCfg)
			cfgMu.Unlock()
			return err
		},
		appVersion,
	)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	sched.Start(ctx)

	tm, err := theme.NewManager(templatesFS)
	if err != nil {
		log.Fatalf("theme: %v", err)
	}
	th := theme.NewHandler(tm)

	indexBytes, err := webdist.ReadFile("webdist/index.html")
	if err != nil {
		log.Fatalf("index.html: %v", err)
	}
	indexTmpl := template.Must(template.New("index").Parse(string(indexBytes)))

	mux := http.NewServeMux()
	apiSrv.Register(mux)
	mux.HandleFunc("/api/theme", th.HandleTheme)
	mux.HandleFunc("/api/schemes", th.HandleSchemes)

	defaultTemplate := "speedplane"
	defaultScheme := "default"
	templatesList := tm.ListTemplates()
	if len(templatesList) > 0 {
		defaultTemplate = templatesList[0]
		if ti := tm.GetTemplate(defaultTemplate); ti != nil {
			for sn := range ti.Schemes {
				defaultScheme = sn
				break
			}
		}
	}

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		_ = indexTmpl.Execute(w, map[string]any{
			"Title":            "dnslat",
			"TemplatesList":    templatesList,
			"TemplateMenuHTML": template.HTML(th.GenerateTemplateMenuHTML(defaultTemplate)),
			"SchemeMenuHTML":   template.HTML(th.GenerateSchemeMenuHTML(defaultTemplate)),
			"CurrentTemplate":  defaultTemplate,
			"CurrentScheme":    defaultScheme,
			"AppVersion":       appVersion,
			"Year":             time.Now().Year(),
		})
	})

	staticSub, err := fs.Sub(webdist, "webdist")
	if err != nil {
		log.Fatal(err)
	}
	api.RegisterStatic(mux, staticSub)

	mux.HandleFunc("/main.js", func(w http.ResponseWriter, r *http.Request) {
		b, err := webdist.ReadFile("webdist/main.js")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
		_, _ = w.Write(b)
	})
	mux.HandleFunc("/main.js.map", func(w http.ResponseWriter, r *http.Request) {
		b, err := webdist.ReadFile("webdist/main.js.map")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write(b)
	})

	handler := http.Handler(mux)
	if !cfg.PublicDashboard {
		handler = localOnly(handler)
		log.Println("[dnslat] public_dashboard=false: HTTP is limited to loopback clients (127.0.0.1 / ::1)")
	}

	planeweblisten.LogURLs("dnslat", "http", tcpAddr)

	ln, err := net.Listen("tcp", tcpAddr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	srv := &http.Server{Handler: withRequestLog(handler)}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[dnslat] http serve: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("[dnslat] shutting down HTTP server…")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[dnslat] HTTP shutdown: %v", err)
	}
	log.Println("[dnslat] exit")
}

// statusRecorder captures HTTP status for request logging.
type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.code = status
	r.ResponseWriter.WriteHeader(status)
}

// Hijack is required for WebSocket upgrades (gorilla/websocket); the wrapper must not hide it.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("ResponseWriter does not support Hijack")
	}
	return hj.Hijack()
}

// Flush forwards optional http.Flusher (SSE, etc.).
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func withRequestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: 200}
		next.ServeHTTP(rec, req)
		log.Printf("[http] %s %s -> %d (%s)", req.Method, req.URL.RequestURI(), rec.code, time.Since(start).Round(time.Millisecond))
	})
}

// localOnly rejects non-loopback clients when public_dashboard is false (no auth; loopback-only access).
func localOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		ip := net.ParseIP(host)
		if ip == nil || !ip.IsLoopback() {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
