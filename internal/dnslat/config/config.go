package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"dnslat/internal/dnslat/model"
)

type Config struct {
	// DataDir is the application data directory (absolute). JSON key: data_dir.
	DataDir string `json:"-"`
	// ConfigFile is the absolute path of the JSON file we load/save.
	ConfigFile string `json:"-"`
	// DBPath is the SQLite DB file path (absolute or relative to config file dir when loading). JSON: db_path.
	DBPath string `json:"-"`
	// ListenAddr is host:port or :port for the HTTP server. JSON: listen_addr. Overridden by CLI when --listen/--listen-port are passed.
	ListenAddr string `json:"-"`
	// PublicDashboard when false allows HTTP only from loopback clients (127.0.0.1 / ::1). JSON: public_dashboard (default true if omitted).
	PublicDashboard    bool                 `json:"-"`
	SaveManualRuns     bool                 `json:"save_manual_runs"`
	DefaultQueryDomain string               `json:"default_query_domain"`
	Schedules          []model.Schedule     `json:"schedules,omitempty"`
	LastRun            map[string]time.Time `json:"last_run,omitempty"`
}

func Default() Config {
	return Config{
		PublicDashboard:    true,
		SaveManualRuns:     false,
		DefaultQueryDomain: "example.com",
		Schedules:          nil,
		LastRun:            make(map[string]time.Time),
	}
}

func ResolveConfigPath(configPath string) string {
	if configPath == "" {
		wd, _ := os.Getwd()
		return filepath.Join(wd, "dnslat.config")
	}
	if strings.HasSuffix(configPath, string(filepath.Separator)) || strings.HasSuffix(configPath, "/") {
		return filepath.Join(configPath, "dnslat.config")
	}
	if info, err := os.Stat(configPath); err == nil && info.IsDir() {
		return filepath.Join(configPath, "dnslat.config")
	}
	return configPath
}

func Load(configPath string) (Config, error) {
	cfgPath := ResolveConfigPath(configPath)
	absCfg, _ := filepath.Abs(cfgPath)
	if absCfg == "" {
		absCfg = cfgPath
	}
	f, err := os.Open(cfgPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			cfg := Default()
			cfg.DataDir = filepath.Dir(absCfg)
			cfg.ConfigFile = absCfg
			cfg.DBPath = filepath.Join(cfg.DataDir, "dnslat.results")
			cfg.ListenAddr = ":8090"
			return cfg, nil
		}
		return Config{}, err
	}
	defer f.Close()
	var fc fileConfig
	if err := json.NewDecoder(f).Decode(&fc); err != nil {
		return Config{}, err
	}
	baseDir := filepath.Dir(absCfg)
	cfg := Config{
		ConfigFile:         absCfg,
		DataDir:            baseDir,
		DBPath:             fc.DBPath,
		ListenAddr:         fc.ListenAddr,
		SaveManualRuns:     fc.SaveManualRuns,
		DefaultQueryDomain: fc.DefaultQueryDomain,
		Schedules:          fc.Schedules,
		LastRun:            fc.LastRun,
	}
	if fc.PublicDashboard == nil {
		cfg.PublicDashboard = true
	} else {
		cfg.PublicDashboard = *fc.PublicDashboard
	}
	if strings.TrimSpace(fc.DataDir) != "" {
		cfg.DataDir = fc.DataDir
		if !filepath.IsAbs(cfg.DataDir) {
			cfg.DataDir = filepath.Join(baseDir, cfg.DataDir)
		}
	}
	cfg.DataDir = filepath.Clean(cfg.DataDir)

	if strings.TrimSpace(cfg.DBPath) != "" {
		if !filepath.IsAbs(cfg.DBPath) {
			cfg.DBPath = filepath.Join(baseDir, cfg.DBPath)
		}
		cfg.DBPath = filepath.Clean(cfg.DBPath)
	}

	if cfg.LastRun == nil {
		cfg.LastRun = make(map[string]time.Time)
	}
	if cfg.DefaultQueryDomain == "" {
		cfg.DefaultQueryDomain = "example.com"
	}
	if cfg.ListenAddr == "" {
		cfg.ListenAddr = ":8090"
	}
	return cfg, nil
}

type fileConfig struct {
	DataDir           string               `json:"data_dir,omitempty"`
	DBPath            string               `json:"db_path,omitempty"`
	ListenAddr        string               `json:"listen_addr,omitempty"`
	PublicDashboard   *bool                `json:"public_dashboard,omitempty"`
	SaveManualRuns    bool                 `json:"save_manual_runs"`
	DefaultQueryDomain string              `json:"default_query_domain"`
	Schedules         []model.Schedule     `json:"schedules,omitempty"`
	LastRun           map[string]time.Time `json:"last_run,omitempty"`
}

func Save(cfg Config) error {
	cfgPath := cfg.ConfigFile
	if cfgPath == "" {
		cfgPath = filepath.Join(cfg.DataDir, "dnslat.config")
	}
	dir := filepath.Dir(cfgPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp := cfgPath + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	pub := cfg.PublicDashboard
	fc := fileConfig{
		DataDir:            cfg.DataDir,
		DBPath:             cfg.DBPath,
		ListenAddr:         cfg.ListenAddr,
		PublicDashboard:    &pub,
		SaveManualRuns:     cfg.SaveManualRuns,
		DefaultQueryDomain: cfg.DefaultQueryDomain,
		Schedules:          cfg.Schedules,
		LastRun:            cfg.LastRun,
	}
	if err := enc.Encode(fc); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, cfgPath)
}
